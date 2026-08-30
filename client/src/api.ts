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
  exportUrl: (id: string, report: string, q: Query = {}) =>
    `${API}/analytics/${id}/export${toQueryString({ ...q, report, format: 'csv' })}`,

  // Goals
  getGoals: (id: string) => json(`/goals/${id}`),
  createGoal: (id: string, data: unknown) => json(`/goals/${id}`, { method: 'POST', body: JSON.stringify(data) }),
  deleteGoal: (id: string, goalId: string) => json(`/goals/${id}/${goalId}`, { method: 'DELETE' }),
  goalReport: (id: string, q: Query = {}) => json(`/goals/${id}/report${toQueryString(q)}`),

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

  // Admin
  adminStats: () => json('/admin/stats'),
  adminUsers: () => json('/admin/users'),
  adminHealth: () => json('/admin/health'),
  adminSuggestions: () => json('/admin/suggestions'),

  sendSuggestion: (message: string) =>
    json('/suggestions', { method: 'POST', body: JSON.stringify({ message }) }),

  setTokens, clearTokens, getToken,
};
