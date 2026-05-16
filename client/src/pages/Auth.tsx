import React, { useState } from 'react';
import { api } from '../api';

export default function Auth({ onAuth }: { onAuth: () => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    const res = isLogin
      ? await api.login({ email, password })
      : await api.register({ email, password, name });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error?.message || data.error || 'Something went wrong'); return; }
    api.setTokens(data.accessToken, data.refreshToken);
    onAuth();
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>{isLogin ? 'Welcome back' : 'Create account'}</h2>
        <p>{isLogin ? 'Sign in to your Pulse Analytics dashboard' : 'Start tracking your projects in seconds'}</p>
        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <div className="form-group">
              <label>Name</label>
              <input placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
            </div>
          )}
          <div className="form-group">
            <label>Email</label>
            <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" placeholder="Min 8 characters" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
          </div>
          {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 14 }}>{error}</p>}
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
            {loading ? 'Loading...' : isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>
        <div className="auth-footer">
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <a href="#" onClick={(e) => { e.preventDefault(); setIsLogin(!isLogin); setError(''); }}>
            {isLogin ? 'Sign up' : 'Sign in'}
          </a>
        </div>
      </div>
    </div>
  );
}
