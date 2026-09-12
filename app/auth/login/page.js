'use client';

import { useEffect, useState } from 'react';
import { LockKeyhole, LogIn, UserRound, Loader2 } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((response) => {
        if (response.ok) window.location.replace('/calls');
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || 'Invalid username or password.');
        return;
      }
      window.location.replace('/calls');
    } catch {
      setError('Unable to reach the server. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex justify-end mb-4"><ThemeToggle /></div>
        <div className="glass-card p-7 sm:p-9">
          <div className="flex items-center gap-3 mb-7">
            <div className="w-11 h-11 rounded-2xl bg-accent/15 text-accent flex items-center justify-center">
              <LockKeyhole className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Call Center Login</h1>
              <p className="text-sm text-muted mt-1">Sign in to manage your AI calls</p>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="block text-sm font-medium text-foreground mb-1.5">Username</span>
              <div className="relative">
                <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus required className="w-full rounded-xl border border-border bg-surface px-10 py-3 text-sm text-foreground outline-none focus:border-accent" />
              </div>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-foreground mb-1.5">Password</span>
              <div className="relative">
                <LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="w-full rounded-xl border border-border bg-surface px-10 py-3 text-sm text-foreground outline-none focus:border-accent" />
              </div>
            </label>
            {error && <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={loading} className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-60 flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="text-xs text-muted mt-5">Your login stays active for 30 days on this browser.</p>
        </div>
      </div>
    </div>
  );
}
