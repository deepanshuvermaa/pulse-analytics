const API = '/api';

function getToken() { return localStorage.getItem('token'); }

function setTokens(access: string, refresh: string) {
  localStorage.setItem('token', access);
  localStorage.setItem('refreshToken', refresh);
}

function clearTokens() {
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
}

/** Single-flight refresh: concurrent 401s share one refresh call instead of racing. */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${API}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so callers awaiting this promise still see it.
      setTimeout(() => { refreshInFlight = null; }, 0);
    }
  })();

  return refreshInFlight;
}

/** Fetches an authenticated file and saves it under the server's filename. */
async function saveDownload(path: string, fallbackName: string): Promise<void> {
  const res = await request(path);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function request(path: string, opts: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res = await fetch(API + path, { ...opts, headers });

  if (res.status === 401 && token) {
    if (await refreshTokens()) {
      headers.Authorization = `Bearer ${getToken()}`;
      res = await fetch(API + path, { ...opts, headers });
    } else {
      clearTokens();
      window.location.href = '/login';
    }
  }

  return res;
}

/** Throwing variant — every dashboard fetch goes through this. */
async function json<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await request(path, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.formErrors?.[0] || (typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`));
  }
  return res.json();
}

export interface Query {
  preset?: string;
  from?: string;
  to?: string;
  granularity?: string;
  compare?: string;
  [key: string]: string | undefined;
}

export function toQueryString(query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const api = {
  // Auth
  register: (data: unknown) => request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: unknown) => request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  me: () => json('/auth/me'),
  logout: () => {
    const rt = localStorage.getItem('refreshToken');
    clearTokens();
    return request('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: rt }) });
  },

  // Projects
  getProjects: () => json('/projects'),
  createProject: (data: unknown) => json('/projects', { method: 'POST', body: JSON.stringify(data) }),
  getProject: (id: string) => json(`/projects/${id}`),
  updateProject: (id: string, data: unknown) => json(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProject: (id: string) => json(`/projects/${id}`, { method: 'DELETE' }),
  regenerateProject: (id: string) => json(`/projects/${id}/regenerate`, { method: 'POST' }),
  rotateWriteKey: (id: string) => json(`/projects/${id}/rotate-write-key`, { method: 'POST' }),
  setupStatus: (id: string) => json(`/projects/${id}/setup-status`),
  getMembers: (id: string) => json(`/projects/${id}/members`),
  addMember: (id: string, data: unknown) => json(`/projects/${id}/members`, { method: 'POST', body: JSON.stringify(data) }),
  removeMember: (id: string, userId: string) => json(`/projects/${id}/members/${userId}`, { method: 'DELETE' }),
  setShare: (id: string, data: unknown) => json(`/projects/${id}/share`, { method: 'POST', body: JSON.stringify(data) }),

  // Analytics — every report takes the same range + filter query
  report: <T = any>(id: string, name: string, q: Query = {}): Promise<T> =>
    json<T>(`/analytics/${id}/${name}${toQueryString(q)}`),
  breakdown: (id: string, dimension: string, q: Query = {}) =>
    json(`/analytics/${id}/breakdown/${dimension}${toQueryString(q)}`),
  live: (id: string) => json(`/analytics/${id}/live`),
  resolveError: (id: string, fingerprint: string, resolved: boolean) =>
    json(`/analytics/${id}/errors/${fingerprint}/resolve?resolved=${resolved}`, { method: 'POST' }),
  heatmap: (id: string, path: string, q: Query = {}) =>
    json(`/analytics/${id}/heatmap${toQueryString({ ...q, path })}`),
  /** One report as CSV. A plain link can't carry the bearer token, so fetch then save. */
  downloadReport: (id: string, report: string, q: Query = {}) =>
    saveDownload(`/analytics/${id}/export${toQueryString({ ...q, report, format: 'csv' })}`, `${report}.csv`),
  /** Whole project for an AI: format "md" (readable report) or "json" (full data). */
  downloadAiExport: (id: string, format: 'md' | 'json', q: Query = {}) =>
    saveDownload(`/analytics/${id}/ai-export${toQueryString({ ...q, format })}`, `pulse-export.${format}`),
  /** The same report as text, for pasting straight into an AI chat. */
  aiExportText: async (id: string, q: Query = {}) => {
    const res = await request(`/analytics/${id}/ai-export${toQueryString({ ...q, download: '0' })}`);
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.text();
  },

  // Goals
  getGoals: (id: string) => json(`/goals/${id}`),
  createGoal: (id: string, data: unknown) => json(`/goals/${id}`, { method: 'POST', body: JSON.stringify(data) }),
  deleteGoal: (id: string, goalId: string) => json(`/goals/${id}/${goalId}`, { method: 'DELETE' }),
  goalReport: (id: string, q: Query = {}) => json(`/goals/${id}/report${toQueryString(q)}`),

  // Revenue
  revenueOverview: (id: string, q: Query = {}) => json(`/payments/${id}/overview${toQueryString(q)}`),
  revenueTimeseries: (id: string, q: Query = {}) => json(`/payments/${id}/timeseries${toQueryString(q)}`),
  revenueChannels: (id: string, q: Query = {}) => json(`/payments/${id}/channels${toQueryString(q)}`),

  // Lead hub
  getLeads: (id: string, q: Query = {}) => json(`/leads/${id}${toQueryString(q)}`),
  leadSummary: (id: string) => json(`/leads/${id}/summary`),
  getLead: (id: string, leadId: string) => json(`/leads/${id}/${leadId}`),
  updateLead: (id: string, leadId: string, data: { status?: string; notes?: string | null }) =>
    json(`/leads/${id}/${leadId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  addLead: (id: string, data: Record<string, string>) =>
    json(`/leads/${id}`, { method: 'POST', body: JSON.stringify(data) }),
  // Client websites (ZeroBuild)
  getSites: (id: string) => json(`/sites/${id}`),
  createSite: (id: string, data: unknown) => json(`/sites/${id}`, { method: 'POST', body: JSON.stringify(data) }),
  deploySite: (id: string, siteId: string, data: unknown) =>
    json(`/sites/${id}/${siteId}/deploy`, { method: 'POST', body: JSON.stringify(data) }),
  syncCatalog: (id: string, siteId: string, products: unknown[]) =>
    json(`/sites/${id}/${siteId}/catalog`, { method: 'PUT', body: JSON.stringify({ products }) }),
  downloadSite: async (id: string, siteId: string, siteUrl = '') => {
    const res = await request(`/sites/${id}/${siteId}/download${siteUrl ? `?siteUrl=${encodeURIComponent(siteUrl)}` : ''}`);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: 'site.zip' }).click();
    URL.revokeObjectURL(url);
  },

  // Agency PC jobs (voice calls, hunts …)
  queueJob: (id: string, kind: string, params: Record<string, unknown> = {}) =>
    json(`/agency/${id}/jobs`, { method: 'POST', body: JSON.stringify({ kind, params }) }),
  getJobs: (id: string, q: Query = {}) => json(`/agency/${id}/jobs${toQueryString(q)}`),

  // Hunt plans
  getHunts: (id: string) => json(`/hunts/${id}`),
  createHunt: (id: string, data: unknown) => json(`/hunts/${id}`, { method: 'POST', body: JSON.stringify(data) }),
  updateHunt: (id: string, planId: string, data: unknown) =>
    json(`/hunts/${id}/${planId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteHunt: (id: string, planId: string) => json(`/hunts/${id}/${planId}`, { method: 'DELETE' }),
  previewPlaces: (id: string, data: { regions: string[]; maxPerRegion?: number; includeTowns?: boolean }) =>
    json(`/hunts/${id}/preview-places`, { method: 'POST', body: JSON.stringify(data) }),
  /** Authenticated download — a plain link can't carry the bearer token. */
  exportLeads: async (id: string, q: Query = {}) => {
    const res = await request(`/leads/${id}/export${toQueryString(q)}`);
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `leads-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  },

  // Funnels
  getFunnels: (id: string) => json(`/funnels/${id}`),
  createFunnel: (id: string, data: unknown) => json(`/funnels/${id}`, { method: 'POST', body: JSON.stringify(data) }),
  deleteFunnel: (id: string, funnelId: string) => json(`/funnels/${id}/${funnelId}`, { method: 'DELETE' }),
  funnelReport: (id: string, funnelId: string, q: Query = {}) =>
    json(`/funnels/${id}/${funnelId}/report${toQueryString(q)}`),
  previewFunnel: (id: string, data: unknown, q: Query = {}) =>
    json(`/funnels/${id}/preview${toQueryString(q)}`, { method: 'POST', body: JSON.stringify(data) }),

  // Alerts
  getAlerts: (id: string) => json(`/alerts/${id}`),
  createAlert: (id: string, data: unknown) => json(`/alerts/${id}`, { method: 'POST', body: JSON.stringify(data) }),
  deleteAlert: (id: string, alertId: string) => json(`/alerts/${id}/${alertId}`, { method: 'DELETE' }),

  // API keys — read-only programmatic / AI-agent access
  getApiKeys: (id: string) => json(`/projects/${id}/api-keys`),
  createApiKey: (id: string, name: string) =>
    json(`/projects/${id}/api-keys`, { method: 'POST', body: JSON.stringify({ name }) }),
  revokeApiKey: (id: string, keyId: string) =>
    json(`/projects/${id}/api-keys/${keyId}`, { method: 'DELETE' }),

  // Admin
  adminStats: () => json('/admin/stats'),
  adminProjects: (search?: string) =>
    json(`/admin/projects${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  adminUser: (userId: string) => json(`/admin/users/${userId}`),
  adminSetUserRole: (userId: string, role: string) =>
    json(`/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  adminActivity: (days = 30) => json(`/admin/activity?days=${days}`),
  adminUsers: () => json('/admin/users'),
  adminHealth: () => json('/admin/health'),
  adminSuggestions: () => json('/admin/suggestions'),

  sendSuggestion: (message: string) =>
    json('/suggestions', { method: 'POST', body: JSON.stringify({ message }) }),

  setTokens, clearTokens, getToken,
};
