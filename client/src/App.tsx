import React, { useState, useEffect } from 'react';
import { api } from './api';
import Auth from './pages/Auth';
import Projects from './pages/Projects';
import Dashboard from './pages/Dashboard';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [currentProject, setCurrentProject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (api.getToken()) setUser(true);
    setLoading(false);
  }, []);

  if (loading) return <div className="container"><p>Loading...</p></div>;

  if (!user) return <Auth onAuth={() => setUser(true)} />;

  if (currentProject) return (
    <Dashboard projectId={currentProject} onBack={() => setCurrentProject(null)}
      onLogout={() => { api.logout(); setUser(null); }} />
  );

  return <Projects onSelect={setCurrentProject} onLogout={() => { api.logout(); setUser(null); }} />;
}
