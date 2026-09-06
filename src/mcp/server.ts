/**
 * In-process MCP server, exposed on the same Hono app at `/mcp`.
 *
 * Streamable HTTP transport. Accepts JSON-RPC 2.0 POSTs, returns either a
 * 200 (notifications, immediate responses) or a 202-accepted body. Mirrors
 * the surface of `mcp/index.js` (the standalone stdio server) but routes
 * through the in-process `/api/v1` handlers so it needs no second process.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { resolveApiKey } from '../lib/api-keys.js';
import { MCP_TOOLS, SERVER_INFO } from './tools.js';

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

const mcpServer = new Hono();

mcpServer.get('/', (c) => c.json({
  name: SERVER_INFO.name,
  version: SERVER_INFO.version,
  description: SERVER_INFO.description,
  transport: 'streamable-http',
  endpoint: '/mcp',
  tools: MCP_TOOLS.length,
}));

mcpServer.post('/', async (c: Context) => {
  let body: JsonRpcRequest;
  try { body = (await c.req.json()) as JsonRpcRequest; }
  catch { return c.json({ error: 'Invalid JSON-RPC payload' }, 400); }

  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return c.json({ error: 'Malformed JSON-RPC envelope' }, 400);
  }
  if (body.id === undefined) return c.body(null, 204);

  const id = body.id;
  const ok = (result: unknown) => c.json({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string) =>
    c.json({ jsonrpc: '2.0', id, error: { code, message } });

  try {
    switch (body.method) {
      case 'initialize':
        return ok({
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_INFO.name, version: SERVER_INFO.version },
        });
      case 'ping': return ok({ ok: true });
      case 'tools/list':
        return ok({ tools: MCP_TOOLS });
      case 'tools/call':
        return await runTool(c, body.params ?? {}, id, ok, fail);
      default:
        return fail(-32601, `Method not implemented: ${body.method}`);
    }
  } catch (e) {
    return fail(-32603, e instanceof Error ? e.message : 'Internal error');
  }
});

async function runTool(
  c: Context,
  params: Record<string, unknown>,
  id: JsonRpcId,
  ok: (r: unknown) => Response,
  fail: (code: number, message: string) => Response,
): Promise<Response> {
  const name = String(params.name ?? '');
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) return fail(-32602, `Unknown tool: ${name}`);

  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const key = String(args.api_key ?? c.req.header('x-pulse-key') ?? '');
  if (!key) return fail(-32004, 'Provide api_key in tool arguments.');
  const resolved = await resolveApiKey(key).catch(() => null);
  if (!resolved) return fail(-32004, 'Invalid or revoked API key.');

  const result = await callV1(tool.name, args, resolved.project.id, c);
  return ok({
    content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
  });
}

async function callV1(tool: string, args: Record<string, unknown>, projectId: string, c: Context): Promise<unknown> {
  const preset = String(args.preset ?? 'last_7d');
  const compare = args.compare === 'previous' || args.compare === 'year_over_year' ? String(args.compare) : undefined;
  const base = new URLSearchParams({ project: projectId, preset, ...(compare ? { compare } : {}) }).toString();

  switch (tool) {
    case 'pulse_overview':     return hit(`/v1/summary?${base}`, c);
    case 'pulse_timeseries':   return hit(`/v1/timeseries?${base}&granularity=${args.granularity ?? 'day'}`, c);
    case 'pulse_pages':        return hit(`/v1/pages?${base}&limit=${args.limit ?? 50}`, c);
    case 'pulse_breakdown':    return hit(`/v1/breakdown/${args.dimension}?${base}&limit=${args.limit ?? 25}`, c);
    case 'pulse_insights':     return hit(`/v1/insights?${base}`, c);
    case 'pulse_funnels':      return hit(`/v1/funnels?${base}`, c);
    case 'pulse_funnel_report':return hit(`/v1/funnels/${args.funnel_id}?${base}`, c);
    case 'pulse_goals':        return hit(`/v1/goals?${base}`, c);
    case 'pulse_alerts':       return hit(`/v1/alerts?${base}`, c);
    case 'pulse_events':       return hit(`/v1/events?${base}`, c);
    case 'pulse_live':         return hit(`/v1/live?${base}`, c);
    case 'pulse_revenue':      return hit(`/payments/${projectId}/overview?preset=${preset}`, c);
    default: throw new Error(`Unhandled tool: ${tool}`);
  }
}

/** Walk the in-process Hono router by reconstructing a synthetic request. */
async function hit(path: string, c: Context): Promise<unknown> {
  const url = new URL(path, c.req.url);
  const fetcher = (globalThis as { __pulseApp?: { fetch: (r: Request) => Promise<Response> } }).__pulseApp;
  const res = fetcher
    ? await fetcher.fetch(new Request(url.toString(), { method: 'GET' }))
    : await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) throw new Error(`Upstream ${res.status}: ${await res.text()}`);
  return res.json();
}

export default mcpServer;