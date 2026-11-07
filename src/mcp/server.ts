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
import { MCP_TOOLS, SERVER_INFO, toolRoute } from './tools.js';

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

/**
 * The project API key, from wherever the client can put it: Authorization
 * header, x-pulse-key header, ?key= on the connector URL (for apps that only
 * accept a URL), or an api_key tool argument.
 */
function apiKeyFrom(c: Context, args: Record<string, unknown>): string {
  const auth = c.req.header('authorization') || '';
  return (
    (auth.startsWith('Bearer ') ? auth.slice(7).trim() : '') ||
    c.req.header('x-pulse-key') ||
    c.req.query('key') ||
    (typeof args.api_key === 'string' ? args.api_key : '')
  ).trim();
}

async function runTool(
  c: Context,
  params: Record<string, unknown>,
  id: JsonRpcId,
  ok: (r: unknown) => Response,
  fail: (code: number, message: string) => Response,
): Promise<Response> {
  const name = String(params.name ?? '');
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const route = toolRoute(name, args);
  if (!route) return fail(-32602, `Unknown tool: ${name}`);

  const key = apiKeyFrom(c, args);
  if (!key) return fail(-32004, 'Missing API key. Add ?key=pk_… to the connector URL or send Authorization: Bearer pk_….');
  const resolved = await resolveApiKey(key).catch(() => null);
  if (!resolved) return fail(-32004, 'Invalid or revoked API key.');

  const res = await callV1(route, key, c);
  const text = await res.text();
  if (!res.ok) {
    return ok({ isError: true, content: [{ type: 'text', text: `Pulse returned ${res.status}: ${text.slice(0, 500)}` }] });
  }
  // Markdown (export) passes through as-is; JSON is pretty-printed for the model.
  const body = (res.headers.get('content-type') || '').includes('json') ? JSON.stringify(JSON.parse(text), null, 2) : text;
  return ok({ content: [{ type: 'text', text: body }] });
}

/** Runs the request against the in-process app, so it needs no network hop. */
async function callV1(route: string, key: string, c: Context): Promise<Response> {
  const url = new URL(`/api/v1${route}`, c.req.url);
  const req = new Request(url.toString(), { method: 'GET', headers: { authorization: `Bearer ${key}` } });
  const app = (globalThis as { __pulseApp?: { fetch: (r: Request) => Promise<Response> | Response } }).__pulseApp;
  return app ? await app.fetch(req) : await fetch(req);
}

export default mcpServer;