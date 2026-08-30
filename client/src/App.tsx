import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from './api';
import Landing from './pages/Landing';
import Auth from './pages/Auth';
import Projects from './pages/Projects';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';
import Share from './pages/Share';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = api.getToken();
    if (token) {
      // Always fetch fresh user data from server
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.user) { setUser(data.user); localStorage.setItem('pulse_user', JSON.stringify(data.user)); }
          else { api.clearTokens(); localStorage.removeItem('pulse_user'); }
          setLoading(false);
        })
        .catch(() => setLoading(false));
    } else { setLoading(false); }
  }, []);

  function handleAuth(userData: any) {
    setUser(userData);
    localStorage.setItem('pulse_user', JSON.stringify(userData));
  }

  function handleLogout() {
    api.logout();
    setUser(null);
    localStorage.removeItem('pulse_user');
  }

  if (loading) return null;

  return (
    <Routes>
      {/* Public shared dashboards need no session at all. */}
      <Route path="/share/:slug" element={<Share />} />
      <Route path="/" element={user ? <Navigate to="/projects" /> : <Landing />} />
      <Route path="/login" element={user ? <Navigate to="/projects" /> : <Auth mode="login" onAuth={handleAuth} />} />
      <Route path="/signup" element={user ? <Navigate to="/projects" /> : <Auth mode="signup" onAuth={handleAuth} />} />
      <Route path="/projects" element={user ? <Projects user={user} onLogout={handleLogout} /> : <Navigate to="/login" />} />
      <Route path="/dashboard/:id" element={user ? <Dashboard user={user} onLogout={handleLogout} /> : <Navigate to="/login" />} />
      <Route path="/admin" element={user?.role === 'admin' ? <Admin onLogout={handleLogout} /> : <Navigate to="/" />} />
    </Routes>
  );
}
