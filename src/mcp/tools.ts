/**
 * MCP Tool Definitions for Pulse Analytics
 */

export const MCP_TOOLS = [
  {
    name: "pulse_overview",
    description: "Get headline metrics: visitors, pageviews, bounce rate, session duration, conversion rate.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Project ID" },
        preset: { type: "string", description: "Time preset: 24h, 7d, 30d, 90d", default: "7d" },
        compare: { type: "boolean", description: "Compare with previous period", default: false },
      },
      required: ["project_id"],
    },
  },
  {
    name: "pulse_timeseries",
    description: "Get visitor and pageview data over time.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Project ID" },
        preset: { type: "string", description: "Time preset", default: "30d" },
        granularity: { type: "string", description: "hour, day, week, month", default: "day" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "pulse_pages",
    description: "Get top pages by views, time on page, bounce rate, and exit rate.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Project ID" },
        preset: { type: "string", description: "Time preset", default: "7d" },
        limit: { type: "number", description: "Number of pages", default: 50 },
      },
      required: ["project_id"],
    },
  },
  {
    name: "pulse_breakdown",
    description: "Get breakdown by dimension: device, browser, os, country, source, channel.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Project ID" },
        dimension: { type: "string", description: "Dimension: source, channel, country, device, browser, os" },
        preset: { type: "string", description: "Time preset", default: "7d" },
        limit: { type: "number", description: "Number of results", default: 25 },
      },
      required: ["project_id", "dimension"],
    },
  },
  {
    name: "pulse_insights",
    description: "Get AI-ready summary with narrative.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Project ID" },
        preset: { type: "string", description: "Time preset", default: "7d" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "pulse_funnels",
    description: "List all funnels for a project.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Project ID" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "pulse_funnel_report",
    description: "Get funnel conversion analysis.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Project ID" },
        funnel_id: { type: "string", description: "Funnel ID" },
        preset: { type: "string", description: "Time preset", default: "7d" },
      },
      required: ["project_id", "funnel_id"],
    },
  },
  {
    name: "pulse_goals",
    description: "List all goals for a project.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Project ID" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "pulse_alerts",
    description: "List all alerts for a project.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Project ID" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "pulse_events",
    description: "Get custom event counts.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Project ID" },
        preset: { type: "string", description: "Time preset", default: "7d" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "pulse_live",
    description: "Get real-time visitor count.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Project ID" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "pulse_revenue",
    description: "Get revenue metrics attributed to traffic sources.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Project ID" },
        preset: { type: "string", description: "Time preset", default: "30d" },
      },
      required: ["project_id"],
    },
  },
];

export const SERVER_INFO = {
  name: "Pulse Analytics MCP Server",
  version: "1.0.0",
  description: "AI-powered analytics tools for Pulse Analytics",
};
