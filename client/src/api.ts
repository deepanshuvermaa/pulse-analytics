const API = '/api';

function getToken() { return localStorage.getItem('token'); }
function setTokens(access: string, refresh: string) {
  localStorage.setItem('token', access);
  localStorage.setItem('refreshToken', refresh);
}
function clearTokens() { localStorage.removeItem('token'); localStorage.removeItem('refreshToken'); }

async function request(path: string, opts: RequestInit = {}) {
  const headers: any = { 'Content-Type': 'application/json', ...opts.headers };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res = await fetch(API + path, { ...opts, headers });

  if (res.status === 401 && token) {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      const refreshRes = await fetch(API + '/auth/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        setTokens(data.accessToken, data.refreshToken);
        headers['Authorization'] = `Bearer ${data.accessToken}`;
        res = await fetch(API + path, { ...opts, headers });
      } else { clearTokens(); window.location.href = '/'; }
    }
  }
  return res;
}

export const api = {
  // Auth
  register: (data: any) => request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: any) => request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  logout: () => { const rt = localStorage.getItem('refreshToken'); clearTokens(); return request('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: rt }) }); },

  // Projects
  getProjects: () => request('/projects'),
  createProject: (data: any) => request('/projects', { method: 'POST', body: JSON.stringify(data) }),
  deleteProject: (id: string) => request(`/projects/${id}`, { method: 'DELETE' }),
  regenerateProject: (id: string) => request(`/projects/${id}/regenerate`, { method: 'POST' }),
  getProject: (id: string) => request(`/projects/${id}`),

  // Analytics
  getOverview: (id: string, from?: string, to?: string) => request(`/analytics/${id}/overview?from=${from || ''}&to=${to || ''}`),
  getPageviews: (id: string, from?: string) => request(`/analytics/${id}/pageviews?from=${from || ''}`),
  getPages: (id: string, from?: string) => request(`/analytics/${id}/pages?from=${from || ''}`),
  getReferrers: (id: string, from?: string) => request(`/analytics/${id}/referrers?from=${from || ''}`),
  getDevices: (id: string, from?: string) => request(`/analytics/${id}/devices?from=${from || ''}`),
  getEngagement: (id: string) => request(`/analytics/${id}/engagement`),
  getErrors: (id: string) => request(`/analytics/${id}/errors`),
  getLive: (id: string) => request(`/analytics/${id}/live`),

  setTokens, clearTokens, getToken,
};
