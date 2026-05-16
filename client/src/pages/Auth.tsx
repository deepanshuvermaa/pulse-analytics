import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Sparkles } from 'lucide-react';

export default function Auth({ mode, onAuth }: { mode: 'login' | 'signup'; onAuth: (u: any) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    const res = mode === 'login' ? await api.login({ email, password }) : await api.register({ email, password, name });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error?.message || data.error || 'Something went wrong'); return; }
    api.setTokens(data.accessToken, data.refreshToken);
    onAuth(data.user);
    navigate('/projects');
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden px-4">
      {/* Video background */}
      <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover"><source src="/pulsehero.mp4" type="video/mp4" /></video>
      <div className="absolute inset-0 bg-black/60" />
      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-xl font-semibold text-white">
            <Sparkles className="w-5 h-5 text-meadow-300" /> Pulse Analytics
          </Link>
        </div>
        <div className="bg-white/95 backdrop-blur-xl rounded-2xl p-8 shadow-2xl border border-white/20">
          <h2 className="text-2xl font-bold text-forest mb-1">{mode === 'login' ? 'Welcome back' : 'Create account'}</h2>
          <p className="text-sm text-forest-muted mb-6">{mode === 'login' ? 'Sign in to your dashboard' : 'Start tracking in seconds'}</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-semibold text-forest-muted uppercase tracking-wide mb-1.5">Name</label>
                <input className="w-full px-4 py-2.5 rounded-lg border border-meadow-200 bg-meadow-50 text-forest text-sm focus:outline-none focus:border-meadow-500 focus:ring-2 focus:ring-meadow-500/20" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-forest-muted uppercase tracking-wide mb-1.5">Email</label>
              <input type="email" className="w-full px-4 py-2.5 rounded-lg border border-meadow-200 bg-meadow-50 text-forest text-sm focus:outline-none focus:border-meadow-500 focus:ring-2 focus:ring-meadow-500/20" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-forest-muted uppercase tracking-wide mb-1.5">Password</label>
              <input type="password" className="w-full px-4 py-2.5 rounded-lg border border-meadow-200 bg-meadow-50 text-forest text-sm focus:outline-none focus:border-meadow-500 focus:ring-2 focus:ring-meadow-500/20" placeholder="Min 8 characters" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button className="w-full bg-forest hover:bg-forest-light text-white font-semibold py-3 rounded-full transition-colors" disabled={loading}>
              {loading ? '...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
          <p className="text-center text-sm text-forest-muted mt-6">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <Link to={mode === 'login' ? '/signup' : '/login'} className="font-semibold text-meadow-600 hover:text-meadow-700">
              {mode === 'login' ? 'Sign up' : 'Sign in'}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
