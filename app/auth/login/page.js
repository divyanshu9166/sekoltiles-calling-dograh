'use client';

import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Headphones,
  LockKeyhole,
  LogIn,
  Loader2,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
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
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden flex items-center justify-center py-8 sm:py-12">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-24 h-80 w-80 rounded-full bg-accent/15 blur-3xl" />
        <div className="absolute -bottom-44 -right-24 h-96 w-96 rounded-full bg-indigo-500/15 blur-3xl" />
      </div>

      <div className="relative w-full max-w-6xl px-1 sm:px-4">
        <div className="flex justify-end mb-3 sm:mb-5"><ThemeToggle /></div>
        <div className="grid overflow-hidden rounded-3xl border border-border bg-surface shadow-2xl lg:grid-cols-[1.05fr_0.95fr]">
          <section className="relative overflow-hidden bg-gradient-to-br from-accent via-[#165fa9] to-[#0b2856] px-7 py-9 text-white sm:px-10 lg:min-h-[600px] lg:px-12 lg:py-12">
            <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full border border-white/15" />
            <div className="absolute -bottom-24 -left-20 h-80 w-80 rounded-full border border-white/10" />
            <div className="relative flex h-full flex-col">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/20 bg-white/15 shadow-lg backdrop-blur">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-lg font-bold tracking-tight">Sekol Tiles</p>
                  <p className="text-xs text-white/70">AI Calling Workspace</p>
                </div>
              </div>

              <div className="my-auto py-10 lg:py-0">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium backdrop-blur">
                  <Sparkles className="h-3.5 w-3.5" />
                  Intelligent customer conversations
                </div>
                <h1 className="max-w-md text-3xl font-bold leading-tight sm:text-4xl">Every customer call, clearly in control.</h1>
                <p className="mt-4 max-w-md text-sm leading-6 text-white/75 sm:text-base">Manage outbound calls, incoming enquiries, call transcripts and appointments from one secure place.</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Feature icon={PhoneCall} label="Smart calling" />
                <Feature icon={Headphones} label="Live transcripts" />
                <Feature icon={ShieldCheck} label="Private access" />
              </div>
            </div>
          </section>

          <section className="relative px-6 py-8 sm:px-10 sm:py-12 lg:px-12">
            <div className="mb-8">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/12 text-accent lg:hidden">
                <Bot className="h-5 w-5" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Secure access</p>
              <h2 className="mt-2 text-2xl font-bold text-foreground sm:text-3xl">Welcome back</h2>
              <p className="mt-2 text-sm leading-6 text-muted">Sign in to continue to your calling dashboard.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-foreground">Username</span>
                <div className="relative">
                  <UserRound className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus required placeholder="Enter your username" className="w-full rounded-xl border border-border bg-background px-11 py-3.5 text-sm text-foreground outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10" />
                </div>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-foreground">Password</span>
                <div className="relative">
                  <LockKeyhole className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required placeholder="Enter your password" className="w-full rounded-xl border border-border bg-background px-11 py-3.5 text-sm text-foreground outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10" />
                </div>
              </label>
              {error && <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-600">{error}</p>}
              <button type="submit" disabled={loading} className="group flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition hover:bg-accent/90 disabled:opacity-60">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                {loading ? 'Signing in…' : 'Sign in to dashboard'}
                {!loading && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
              </button>
            </form>

            <div className="mt-7 flex items-start gap-3 rounded-xl border border-border bg-background/60 p-3.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
              <p className="text-xs leading-5 text-muted">Your session is stored securely for 30 days on this browser. You can update credentials anytime from Settings after login.</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2.5 text-xs font-medium text-white/85 backdrop-blur">
      <Icon className="h-4 w-4 text-white" />
      {label}
    </div>
  );
}
