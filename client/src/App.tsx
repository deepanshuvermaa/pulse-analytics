import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from './api';
import Landing from './pages/Landing';
import Auth from './pages/Auth';
import Projects from './pages/Projects';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = api.getToken();
    const stored = localStorage.getItem('pulse_user');
    if (token && stored) setUser(JSON.parse(stored));
    setLoading(false);
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
      <Route path="/" element={user ? <Navigate to="/projects" /> : <Landing />} />
      <Route path="/login" element={user ? <Navigate to="/projects" /> : <Auth mode="login" onAuth={handleAuth} />} />
      <Route path="/signup" element={user ? <Navigate to="/projects" /> : <Auth mode="signup" onAuth={handleAuth} />} />
      <Route path="/projects" element={user ? <Projects user={user} onLogout={handleLogout} /> : <Navigate to="/login" />} />
      <Route path="/dashboard/:id" element={user ? <Dashboard user={user} onLogout={handleLogout} /> : <Navigate to="/login" />} />
      <Route path="/admin" element={user?.role === 'admin' ? <Admin onLogout={handleLogout} /> : <Navigate to="/" />} />
    </Routes>
  );
}
