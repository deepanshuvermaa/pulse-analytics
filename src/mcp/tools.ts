/**
 * MCP tools for Pulse Analytics. Each tool is one read of the public /api/v1
 * surface, so the connector can never do more than the project API key allows.
 * The key decides the project — tools take no project id.
 */

type Args = Record<string, unknown>;

interface ToolDef {
  name: string;
  description: string;
  properties: Record<string, unknown>;
  required?: string[];
  /** Path under /api/v1 with its query string. */
  route: (args: Args) => string;
}

const PERIOD = {
  preset: {
    type: 'string',
    description: 'today | yesterday | last_7d | last_30d | last_90d | month_to_date | last_month | year_to_date | last_12mo | all_time | custom',
  },
  from: { type: 'string', description: 'YYYY-MM-DD, with preset=custom' },
  to: { type: 'string', description: 'YYYY-MM-DD, with preset=custom' },
  compare: { type: 'string', description: 'previous | year_over_year' },
};

const CONTACTS = {
  include_contacts: { type: 'boolean', description: 'Include lead names, phones, emails and messages. Only when the user asked for them.' },
};

/** Builds "path?preset=…&…" from whichever arguments were given. */
function q(path: string, args: Args, extra: Record<string, unknown> = {}): string {
  const params = new URLSearchParams();
  for (const k of ['preset', 'from', 'to', 'compare', 'granularity', 'limit']) {
    if (args[k] !== undefined && args[k] !== '') params.set(k, String(args[k]));
  }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}
const contacts = (args: Args) => (args.include_contacts === true ? 'contacts' : undefined);

const TOOL_DEFS: ToolDef[] = [
  {
    name: 'pulse_export',
    description: 'Start here for broad questions. The whole project in one readable report: headline numbers and what changed, findings, leads, traffic, pages, exits, audience, events, performance, frustration, retention, errors, goals, funnels and revenue. Defaults to the last 30 days compared with the 30 before.',
    properties: { ...PERIOD, ...CONTACTS },
    route: (a) => q('/export', a, { include: contacts(a) }),
  },
  {
    name: 'pulse_insights',
    description: "Short diagnosis: what's working, what isn't, with evidence and a plain-text narrative. Defaults to last 7 days vs the previous 7.",
    properties: PERIOD,
    route: (a) => q('/insights', a),
  },
  {
    name: 'pulse_overview',
    description: 'Headline metrics: visitors, sessions, pageviews, bounce rate, session length, conversions — with change vs a comparison period.',
    properties: PERIOD,
    route: (a) => q('/summary', a),
  },
  {
    name: 'pulse_timeseries',
    description: 'Visitors, sessions, pageviews and conversions over time.',
    properties: { ...PERIOD, granularity: { type: 'string', description: 'hour | day | week | month' } },
    route: (a) => q('/timeseries', a),
  },
  {
    name: 'pulse_pages',
    description: 'Per-page views, visitors, time on page, bounce, exit rate and scroll depth.',
    properties: { ...PERIOD, limit: { type: 'number' } },
    route: (a) => q('/pages', a),
  },
  {
    name: 'pulse_exits',
    description: 'Pages where visitors leave, ranked by exits.',
    properties: { ...PERIOD, limit: { type: 'number' } },
    route: (a) => q('/exits', a),
  },
  {
    name: 'pulse_exit_reasons',
    description: 'Why visitors left one page, and which segments over-index.',
    properties: { ...PERIOD, path: { type: 'string', description: 'Page path, e.g. /pricing' } },
    required: ['path'],
    route: (a) => q('/exit-reasons', a, { path: a.path }),
  },
  {
    name: 'pulse_flow',
    description: 'Visitor journeys as a graph, forwards or backwards from a page.',
    properties: {
      ...PERIOD,
      start_path: { type: 'string' },
      direction: { type: 'string', description: 'forward | reverse' },
      depth: { type: 'number', description: '2–8 steps' },
    },
    route: (a) => q('/flow', a, { startPath: a.start_path, direction: a.direction, depth: a.depth }),
  },
  {
    name: 'pulse_audience',
    description: 'Channels, sources, referrers, devices, browsers, operating systems and countries in one call.',
    properties: PERIOD,
    route: (a) => q('/audience', a),
  },
  {
    name: 'pulse_breakdown',
    description: 'Group traffic by one dimension: source, channel, referrer, country, device, browser, os, utm_source, utm_medium, utm_campaign, entry_page, exit_page.',
    properties: { ...PERIOD, dimension: { type: 'string' }, limit: { type: 'number' } },
    required: ['dimension'],
    route: (a) => q(`/breakdown/${encodeURIComponent(String(a.dimension ?? ''))}`, a),
  },
  {
    name: 'pulse_leads',
    description: 'Lead inbox: totals, leads by source, channel and status, and recent leads.',
    properties: { ...PERIOD, ...CONTACTS, limit: { type: 'number' } },
    route: (a) => q('/leads', a, { include: contacts(a) }),
  },
  {
    name: 'pulse_events',
    description: 'Custom event counts (button clicks, sign-ups and other tracked actions).',
    properties: PERIOD,
    route: (a) => q('/events', a),
  },
  {
    name: 'pulse_performance',
    description: 'Core Web Vitals percentiles (LCP, INP, CLS, FCP, TTFB) and the slowest pages.',
    properties: PERIOD,
    route: (a) => q('/performance', a),
  },
  {
    name: 'pulse_frustration',
    description: 'Rage clicks, dead clicks and errors by page, plus form fields people abandon.',
    properties: PERIOD,
    route: (a) => q('/frustration', a),
  },
  {
    name: 'pulse_retention',
    description: 'Cohort retention (weekly by default).',
    properties: { ...PERIOD, period: { type: 'string', description: 'week | day' } },
    route: (a) => q('/retention', a, { period: a.period }),
  },
  {
    name: 'pulse_errors',
    description: 'Unresolved JavaScript errors, grouped, with affected sessions.',
    properties: PERIOD,
    route: (a) => q('/errors', a),
  },
  {
    name: 'pulse_funnels',
    description: 'Saved funnels (ids, names, steps).',
    properties: {},
    route: () => '/funnels',
  },
  {
    name: 'pulse_funnel_report',
    description: 'Conversion and drop-off for one saved funnel, optionally split by a dimension.',
    properties: { ...PERIOD, funnel_id: { type: 'string' }, breakdown: { type: 'string' } },
    required: ['funnel_id'],
    route: (a) => q(`/funnels/${encodeURIComponent(String(a.funnel_id ?? ''))}`, a, { breakdown: a.breakdown }),
  },
  {
    name: 'pulse_goals',
    description: 'Configured conversion goals.',
    properties: {},
    route: () => '/goals',
  },
  {
    name: 'pulse_alerts',
    description: 'Configured alerts and when they last fired.',
    properties: {},
    route: () => '/alerts',
  },
  {
    name: 'pulse_revenue',
    description: 'Revenue and conversions, with revenue by channel.',
    properties: PERIOD,
    route: (a) => q('/revenue', a),
  },
  {
    name: 'pulse_live',
    description: 'Visitors on the site right now and the pages they are on.',
    properties: {},
    route: () => '/live',
  },
  {
    name: 'pulse_heatmap',
    description: 'Normalised click positions (0–1) on one page.',
    properties: { ...PERIOD, path: { type: 'string' } },
    required: ['path'],
    route: (a) => q('/heatmap', a, { path: a.path }),
  },
];

/** What tools/list returns. */
export const MCP_TOOLS = TOOL_DEFS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: { type: 'object', properties: t.properties, ...(t.required ? { required: t.required } : {}) },
}));

/** Path under /api/v1 for a tool call, or null for an unknown tool. */
export function toolRoute(name: string, args: Args): string | null {
  const tool = TOOL_DEFS.find((t) => t.name === name);
  return tool ? tool.route(args) : null;
}

export const SERVER_INFO = {
  name: 'Pulse Analytics',
  version: '2.0.0',
  description: 'Read-only access to one Pulse project: traffic, pages, audience, leads, performance, errors, funnels and revenue.',
};
