import { describe, it, expect } from 'vitest';
import { exportToMarkdown, type ExportBundle } from '../ai-export.js';
import { MCP_TOOLS, toolRoute } from '../../mcp/tools.js';

const base: ExportBundle = {
  generatedAt: '2026-11-08T03:00:00.000Z',
  project: { id: 'p1', name: 'peripheralservices', domain: 'https://peripheralservices.site', timezone: 'Asia/Kolkata' },
  period: { from: '2026-10-10', to: '2026-11-08', timezone: 'Asia/Kolkata', comparedTo: { from: '2026-09-10', to: '2026-10-09' } },
  errors: {},
};

describe('exportToMarkdown', () => {
  it('renders headline numbers with change and a pages table', () => {
    const md = exportToMarkdown({
      ...base,
      summary: {
        current: { visitors: 78, newVisitors: 78, returningVisitors: 0, sessions: 95, pageviews: 192, pagesPerSession: 2.02,
          bounceRate: 41.1, engagementRate: 58.9, avgSessionSec: 800, conversions: 0, conversionRate: 0, conversionValue: 0,
          rageClicks: 0, deadClicks: 0, errors: 0 },
        previous: null,
        change: { visitors: 25 },
      },
      pages: [{ path: '/wish/', views: 40, visitors: 30, entrances: 30, exits: 20, avgTimeSec: 50, bounceRate: 30, exitRate: 50, avgScroll: 70 }],
    });
    expect(md).toContain('# peripheralservices — analytics export');
    expect(md).toContain('Visitors: 78 (+25.0%)');
    expect(md).toContain('avg session 13m 20s');
    expect(md).toContain('| /wish/ | 40 | 30 |');
  });

  it('withholds lead contact columns unless they were included', () => {
    const leads = {
      total: 1, in_period: 1, won: 0, bySource: [], byChannel: [], byStatus: [],
      recent: [{ name: 'Asha', phone: '919999900003', city: 'Lucknow', source: 'website_form', status: 'new', score: 65 }],
    };
    const hidden = exportToMarkdown({ ...base, leads: { ...leads, contactsIncluded: false } });
    expect(hidden).toContain('contact details withheld');
    expect(hidden).not.toContain('919999900003');
    const shown = exportToMarkdown({ ...base, leads: { ...leads, contactsIncluded: true } });
    expect(shown).toContain('919999900003');
  });

  it('escapes pipes and newlines so a value cannot break a table', () => {
    const md = exportToMarkdown({ ...base, pages: [{ path: '/a|b\nc', views: 1 }] });
    expect(md).toContain('/a\\|b c');
  });

  it('lists sections that failed instead of hiding them', () => {
    expect(exportToMarkdown({ ...base, errors: { retention: 'boom' } })).toContain('- retention: boom');
  });
});

describe('MCP tools', () => {
  it('every listed tool has a route under the v1 API', () => {
    for (const t of MCP_TOOLS) {
      const args = { path: '/x', dimension: 'source', funnel_id: 'f1' };
      expect(toolRoute(t.name, args), t.name).toMatch(/^\/[a-z-]+/);
    }
  });

  it('passes period, contacts and paths through as query parameters', () => {
    expect(toolRoute('pulse_export', { preset: 'last_7d', include_contacts: true })).toBe('/export?preset=last_7d&include=contacts');
    expect(toolRoute('pulse_leads', {})).toBe('/leads');
    expect(toolRoute('pulse_exit_reasons', { path: '/wish/' })).toBe('/exit-reasons?path=%2Fwish%2F');
    expect(toolRoute('pulse_breakdown', { dimension: 'utm_source', limit: 5 })).toBe('/breakdown/utm_source?limit=5');
    expect(toolRoute('nope', {})).toBeNull();
  });
});
