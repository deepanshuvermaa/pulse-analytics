#!/usr/bin/env node
/**
 * Pulse Analytics MCP server.
 *
 * Lets an AI assistant read a project's analytics directly, so the usual
 * questions — "is anything broken?", "why did signups drop?" — can be answered
 * without opening the dashboard.
 *
 * Configuration (environment):
 *   PULSE_API_KEY   required, a read-only project key (pk_…)
 *   PULSE_HOST      required, e.g. https://analytics.example.com
 *
 * The key is read-only and scoped to one project. This server cannot write
 * events, change settings, or reach any other project — the API enforces that,
 * not this process.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const API_KEY = process.env.PULSE_API_KEY;
const HOST = (process.env.PULSE_HOST || '').replace(/\/+$/, '');

if (!API_KEY || !HOST) {
  console.error('Missing configuration. Set PULSE_API_KEY and PULSE_HOST.');
  process.exit(1);
}

const RANGE_PROPS = {
  preset: {
    type: 'string',
    description:
      'Time range. One of: today, yesterday, last_7d, last_30d, last_90d, month_to_date, ' +
      'last_month, year_to_date, last_12mo, all_time, custom. Defaults to last_7d.',
  },
  from: { type: 'string', description: 'Start date YYYY-MM-DD (only with preset=custom).' },
  to: { type: 'string', description: 'End date YYYY-MM-DD (only with preset=custom).' },
  compare: { type: 'string', description: 'previous | year_over_year — adds period-over-period change.' },
};

const FILTER_PROPS = {
  path: { type: 'string', description: 'Restrict to one page path, e.g. /pricing. Supports a trailing * wildcard.' },
  device: { type: 'string', description: 'desktop | mobile | tablet' },
  country: { type: 'string', description: 'ISO-3166 alpha-2 country code, e.g. IN, US.' },
  source: { type: 'string', description: 'Traffic source name, e.g. Google, Reddit, Direct.' },
  channel: { type: 'string', description: 'Organic Search | Paid Search | Organic Social | Referral | Direct | Email | …' },
};

/** Tool name → { path, description, extra input properties }. */
const TOOLS = [
  {
    name: 'get_insights',
    description:
      'START HERE for any open-ended question about how a site is doing. Returns a ready-made ' +
      'analysis: what is working, what is not, each finding with the numbers behind it, plus a ' +
      'plain-text narrative. One call replaces stitching together half a dozen reports.',
    path: '/insights',
    props: RANGE_PROPS,
  },
  {
    name: 'get_summary',
    description: 'Headline metrics: visitors, pageviews, sessions, bounce rate, average session, conversions.',
    path: '/summary',
    props: { ...RANGE_PROPS, ...FILTER_PROPS },
  },
  {
    name: 'get_timeseries',
    description: 'Visitors, pageviews and sessions over time. Use to describe a trend or spot a specific day.',
    path: '/timeseries',
    props: {
      ...RANGE_PROPS,
      ...FILTER_PROPS,
      granularity: { type: 'string', description: 'hour | day | week | month. Defaults to automatic.' },
    },
  },
  {
    name: 'get_pages',
    description: 'Per-page performance: views, unique visitors, average time, bounce rate, exit rate, scroll depth.',
    path: '/pages',
    props: { ...RANGE_PROPS, ...FILTER_PROPS, limit: { type: 'number', description: 'Max rows, default 50.' } },
  },
  {
    name: 'get_exit_pages',
    description: 'Where visitors leave the site, ranked by exits, with exit rate and how many showed frustration signals.',
    path: '/exits',
    props: { ...RANGE_PROPS, ...FILTER_PROPS },
  },
  {
    name: 'explain_exits',
    description:
      'WHY visitors left a specific page. Attributes each exit to a cause — JavaScript error, rage click, ' +
      'dead click, form abandonment, slow load, or left immediately — and reports which audience segments ' +
      'are over-represented among the leavers. Use after get_exit_pages identifies a problem page.',
    path: '/exit-reasons',
    props: {
      ...RANGE_PROPS,
      path: { type: 'string', description: 'The page path to explain, e.g. /checkout. Required.' },
    },
    required: ['path'],
  },
  {
    name: 'get_user_flow',
    description: 'Journey graph as nodes and links. Anchor it to a page to see where people go next, or what led them there.',
    path: '/flow',
    props: {
      ...RANGE_PROPS,
      startPath: { type: 'string', description: 'Anchor page. Omit for site-wide flow.' },
      direction: { type: 'string', description: 'forward (where they go next) | reverse (what led here).' },
      depth: { type: 'number', description: 'Steps to trace, 2-8. Default 4.' },
    },
  },
  {
    name: 'get_breakdown',
    description:
      'Group visitors by a dimension: source, channel, referrer, country, device, browser, os, ' +
      'utm_source, utm_medium, utm_campaign, entry_page, exit_page.',
    path: '/breakdown',
    props: {
      ...RANGE_PROPS,
      ...FILTER_PROPS,
      dimension: { type: 'string', description: 'The dimension to group by. Required.' },
    },
    required: ['dimension'],
    buildPath: (args) => `/breakdown/${encodeURIComponent(args.dimension)}`,
    strip: ['dimension'],
  },
  {
    name: 'get_errors',
    description: 'Unresolved JavaScript errors, grouped, with occurrence counts and how many sessions each affected.',
    path: '/errors',
    props: RANGE_PROPS,
  },
  {
    name: 'get_performance',
    description: 'Core Web Vitals (LCP, INP, CLS, TTFB, FCP) as p50/p75/p90/p99, plus the slowest pages by p75 LCP.',
    path: '/performance',
    props: { ...RANGE_PROPS, ...FILTER_PROPS },
  },
  {
    name: 'get_frustration',
    description: 'Rage clicks, dead clicks, errors, quick-backs and form abandonment by page, including which form field is abandoned.',
    path: '/frustration',
    props: RANGE_PROPS,
  },
  {
    name: 'get_retention',
    description: 'Cohort retention matrix — what share of each cohort returns in later periods.',
    path: '/retention',
    props: { ...RANGE_PROPS, period: { type: 'string', description: 'week | day. Default week.' } },
  },
  {
    name: 'get_custom_events',
    description: 'Counts for custom events sent via pulse("event", name, props).',
    path: '/events',
    props: { ...RANGE_PROPS, ...FILTER_PROPS },
  },
  {
    name: 'list_funnels',
    description: 'List saved funnels for this project, with their step definitions.',
    path: '/funnels',
    props: {},
  },
  {
    name: 'get_funnel',
    description:
      'Compute a saved funnel: how many entered each step, where they dropped off, and median time between steps. ' +
      'Optionally split by device, browser, country, source or campaign to find which segment converts worst.',
    path: '/funnels',
    props: {
      ...RANGE_PROPS,
      funnelId: { type: 'string', description: 'Funnel id from list_funnels. Required.' },
      breakdown: { type: 'string', description: 'device | browser | os | country | source | channel | utm_campaign' },
    },
    required: ['funnelId'],
    buildPath: (args) => `/funnels/${encodeURIComponent(args.funnelId)}`,
    strip: ['funnelId'],
  },
];

async function callApi(path, params) {
  const url = new URL(`${HOST}/api/v1${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      // Surface the server's own message — it is more useful than a status code.
      let detail = text;
      try {
        detail = JSON.parse(text).error ?? text;
      } catch { /* keep raw */ }
      throw new Error(`Pulse API ${res.status}: ${detail}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

const server = new Server(
  { name: 'pulse-analytics', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: {
      type: 'object',
      properties: t.props,
      required: t.required ?? [],
    },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS.find((t) => t.name === request.params.name);
  if (!tool) {
    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }] };
  }

  const args = { ...(request.params.arguments || {}) };
  const path = tool.buildPath ? tool.buildPath(args) : tool.path;
  for (const key of tool.strip ?? []) delete args[key];

  try {
    const data = await callApi(path, args);
    // get_insights carries a prose narrative; lead with it so the model quotes
    // the real analysis rather than re-deriving one from the JSON.
    const text = data && typeof data.narrative === 'string'
      ? `${data.narrative}\n\n---\nStructured data:\n${JSON.stringify(data, null, 2)}`
      : JSON.stringify(data, null, 2);

    return { content: [{ type: 'text', text }] };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`pulse-analytics MCP server ready (host: ${HOST})`);
