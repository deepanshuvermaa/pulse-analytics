# Pulse Analytics MCP server

Read-only access to one Pulse project from an AI assistant, so you can ask
"what's broken on my site?" without opening the dashboard.

## Setup

1. In Pulse, open your project → **Setup** → **API keys & AI access** → create a key.
   The key is shown once; copy it.

2. Add the server to your assistant's MCP config.

   **Claude Desktop** (`claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "pulse": {
         "command": "npx",
         "args": ["-y", "pulse-analytics-mcp"],
         "env": {
           "PULSE_HOST": "https://your-pulse-host",
           "PULSE_API_KEY": "pk_your_key_here"
         }
       }
     }
   }
   ```

3. Restart the assistant. Ask it something like:
   - "How is my site doing this week compared to last?"
   - "Which page loses the most visitors, and why?"
   - "Did conversion drop on mobile?"

## Tools

| Tool | Use it for |
|---|---|
| `get_insights` | **Start here.** What's working, what isn't, with evidence and a narrative. |
| `get_summary` | Visitors, pageviews, bounce rate, conversions. |
| `get_timeseries` | Trend over time. |
| `get_pages` | Per-page views, time, bounce and exit rates. |
| `get_exit_pages` | Where people leave. |
| `explain_exits` | **Why** they left a given page, plus which segments over-index. |
| `get_user_flow` | Journey graph, forwards or backwards from a page. |
| `get_breakdown` | Group by source, channel, country, device, campaign… |
| `get_errors` | Grouped JavaScript errors. |
| `get_performance` | Core Web Vitals percentiles, slowest pages. |
| `get_frustration` | Rage clicks, dead clicks, form abandonment by field. |
| `get_retention` | Cohort retention. |
| `get_custom_events` | Your own tracked events. |
| `list_funnels` / `get_funnel` | Funnel conversion and drop-off, optionally by segment. |

Every tool accepts `preset` (`today`, `last_7d`, `last_30d`, `all_time`, …) or a
custom `from`/`to`, and `compare` for period-over-period change. Dates are
calendar days in the project's configured timezone.

## Security

The key is **read-only and scoped to a single project**. It cannot send events,
change settings, or read any other project — enforced server-side, not here.
Only a hash of the key is stored, so a leaked database yields nothing usable.
Revoke a key at any time from the same settings panel; it stops working immediately.

## Without MCP

The same data is available over plain HTTP. The API describes itself:

```bash
curl -H "Authorization: Bearer pk_your_key" https://your-pulse-host/api/v1/
curl -H "Authorization: Bearer pk_your_key" https://your-pulse-host/api/v1/insights
```
