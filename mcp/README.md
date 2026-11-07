# Pulse Analytics for AI assistants

Read-only access to one Pulse project from an AI assistant, so you can ask
"how did the site do this month, and which leads came from WhatsApp?" without
opening the dashboard.

There are three ways in, all read-only and scoped to one project.

## 1. Export for AI (no setup)

In the dashboard, pick a period and click **Export for AI**:

- **Copy report for AI** — a Markdown report on the clipboard. Paste it into
  ChatGPT, Claude or Gemini and ask anything.
- **Download report (.md)** — the same report as a file.
- **Download full data (.json)** — every report as structured data.

The report covers headline numbers and what changed, Pulse's findings, leads,
traffic over time, pages, exits, sources and campaigns, devices and countries,
custom events, Core Web Vitals, frustration, retention, JavaScript errors,
goals, funnels and revenue. Dashboard downloads include lead contact details.

## 2. Live connector (MCP)

Pulse hosts its own MCP server at `/mcp`. Nothing to install.

1. Project → **Setup** → **API keys & AI access** → create a key. It is shown once.
2. Connector URL: `https://your-pulse-host/mcp?key=pk_your_key`
   - **Claude** (web or desktop): Settings → Connectors → Add custom connector → paste the URL.
   - **ChatGPT, Cursor, other MCP clients**: add it as a remote / streamable-HTTP MCP server.
   - **Claude Desktop config file**:

     ```json
     {
       "mcpServers": {
         "pulse": {
           "command": "npx",
           "args": ["-y", "mcp-remote", "https://your-pulse-host/mcp?key=pk_your_key"]
         }
       }
     }
     ```

   Clients that can send headers may use `Authorization: Bearer pk_…` instead of `?key=`.

### Tools

| Tool | Use it for |
|---|---|
| `pulse_export` | **Start here** for broad questions: the whole project in one report. |
| `pulse_insights` | Short diagnosis: what's working, what isn't, with evidence. |
| `pulse_overview` | Headline metrics with change vs a comparison period. |
| `pulse_timeseries` | Trend over time. |
| `pulse_pages` / `pulse_exits` | Per-page performance; where people leave. |
| `pulse_exit_reasons` | Why visitors left one page, and which segments over-index. |
| `pulse_flow` | Journey graph, forwards or backwards from a page. |
| `pulse_audience` / `pulse_breakdown` | Sources, channels, campaigns, devices, countries… |
| `pulse_leads` | Lead inbox: totals, by source/channel/status, recent leads. |
| `pulse_events` | Custom events (button clicks, sign-ups). |
| `pulse_performance` | Core Web Vitals and slowest pages. |
| `pulse_frustration` | Rage clicks, dead clicks, abandoned form fields. |
| `pulse_retention` | Cohort retention. |
| `pulse_errors` | Unresolved JavaScript errors. |
| `pulse_funnels` / `pulse_funnel_report` | Funnel conversion and drop-off. |
| `pulse_goals` / `pulse_alerts` | Configured goals and alerts. |
| `pulse_revenue` | Revenue and conversions by channel. |
| `pulse_live` | Visitors on the site right now. |
| `pulse_heatmap` | Click positions on one page. |

Period tools accept `preset` (`today`, `last_7d`, `last_30d`, `all_time`, …) or
`from`/`to` with `preset=custom`, plus `compare` (`previous`, `year_over_year`).
Dates are calendar days in the project's timezone.

Lead names, phones and emails are only returned when a tool is called with
`include_contacts: true`.

## 3. Plain HTTP

The API describes itself:

```bash
curl -H "Authorization: Bearer pk_your_key" https://your-pulse-host/api/v1/
curl -H "Authorization: Bearer pk_your_key" "https://your-pulse-host/api/v1/export?preset=last_30d"
curl -H "Authorization: Bearer pk_your_key" "https://your-pulse-host/api/v1/export?format=json&include=contacts"
```

## Security

A key is **read-only and scoped to a single project**. It cannot send events,
change settings, or read any other project — enforced server-side. Only a hash
of the key is stored. Revoke a key from the same settings panel; it stops working
immediately. A key in a connector URL is a secret: anyone with the URL can read
that project's analytics until the key is revoked.
