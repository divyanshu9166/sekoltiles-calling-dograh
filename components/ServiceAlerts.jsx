'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, AlertTriangle, ChevronDown, ChevronUp, RefreshCw, Check, Clock } from 'lucide-react';

const time = value => value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST' : 'Not yet checked';
const labels = { sarvam: 'Sarvam speech', vobiz: 'Vobiz calling', llm: 'LLM responses', dograh: 'Calling engine' };

export default function ServiceAlerts({ onStatusChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(null);
  const alive = useRef(true);
  const refreshing = useRef(false);
  const callback = useRef(onStatusChange);
  callback.current = onStatusChange;

  async function refresh() {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const response = await fetch('/api/service-alerts', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (response.status === 401) { window.location.replace('/auth/login'); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Service status is unavailable.');
      if (!alive.current) return;
      setData(result); setError('');
      callback.current?.({ activeCount: result.activeCount, criticalCount: result.criticalCount, monitorOnline: result.monitor.online });
    } catch (err) {
      if (alive.current) { setError(err.message || 'Service status is unavailable.'); callback.current?.({ monitorOnline: false, activeCount: null }); }
    } finally { refreshing.current = false; }
  }
  useEffect(() => {
    alive.current = true;
    let connection;
    const visible = () => {
      connection?.close();
      if (document.visibilityState !== 'visible') return;
      connection = new EventSource('/api/service-alerts/stream');
      connection.addEventListener('ready', refresh);
      connection.addEventListener('changed', refresh);
      connection.onerror = () => {
        if (alive.current && document.visibilityState === 'visible') {
          setError('Live alerts disconnected. Use Refresh to load saved alerts.');
          callback.current?.({ monitorOnline: false, activeCount: null });
        }
      };
    };
    visible();
    document.addEventListener('visibilitychange', visible);
    return () => { alive.current = false; connection?.close(); document.removeEventListener('visibilitychange', visible); };
  }, []);

  async function update(alert, action) {
    if (action === 'resolve' && !window.confirm('Mark this alert resolved after fixing the provider issue and testing a call? This does not recharge credits or fix the provider.')) return;
    setBusy(alert.id); setError('');
    try {
      const response = await fetch('/api/service-alerts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: alert.id, action, lastSeenAt: alert.lastSeenAt }), signal: AbortSignal.timeout(8000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update the alert.');
      await refresh();
    } catch (err) { setError(err.message); } finally { setBusy(null); }
  }

  const count = data?.activeCount || 0;
  const attention = count > 0 || error || (data && !data.monitor.online);
  const shown = (data?.alerts || []).filter(a => history ? a.status === 'RESOLVED' : a.status !== 'RESOLVED');
  return (
    <section aria-label="Service notifications" className={`rounded-2xl border ${attention ? 'border-amber-500/35 bg-amber-500/5' : 'border-border bg-surface'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <button type="button" onClick={() => setExpanded(v => !v)} aria-expanded={expanded} className="flex min-w-0 items-center gap-3 text-left">
          <span className={`relative rounded-xl p-2 ${attention ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-accent/10 text-accent'}`}><Bell className="h-5 w-5" />{count > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{count}</span>}</span>
          <span><span className="block text-sm font-semibold text-foreground">{count ? `${count} service alert${count === 1 ? '' : 's'} need attention` : 'Service notifications'}</span>
            <span className="block text-xs text-muted">{error ? 'Live updates unavailable — please refresh' : !data ? 'Loading saved alerts…' : !data.monitor.online ? 'Error reporting is not configured' : count ? 'Provider failures reported. Review details before further calling.' : 'Error alerts enabled · No background provider checks'}</span></span>
          {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-muted" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted" />}
        </button>
        <button type="button" onClick={refresh} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground"><RefreshCw className="h-3.5 w-3.5" />Refresh status</button>
      </div>
      {(count > 0 || expanded) && data && <div className="grid grid-cols-1 gap-2 px-4 pb-4 sm:grid-cols-3">
        {['sarvam', 'vobiz', 'llm'].map(service => {
          const active = data.alerts.filter(a => a.service === service && a.status !== 'RESOLVED');
          return <div key={service} className="rounded-xl border border-border bg-surface px-3 py-2 text-xs"><p className="font-semibold text-foreground">{labels[service]}</p><p className={active.length ? 'mt-1 text-red-600 dark:text-red-300' : 'mt-1 text-muted'}>{active.length ? active[0].title : !data.monitor.online ? 'Error reporting not configured' : 'No unresolved failures reported'}</p></div>;
        })}
      </div>}
      {error && <p role="alert" className="px-4 pb-3 text-sm text-red-600 dark:text-red-300">{error}</p>}
      {expanded && data && <div className="space-y-3 border-t border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><div className="flex gap-2"><button type="button" onClick={() => setHistory(false)} aria-pressed={!history} className={`rounded-lg px-3 py-1.5 ${!history ? 'bg-accent/15 text-accent' : 'bg-surface'}`}>Active ({count})</button><button type="button" onClick={() => setHistory(true)} aria-pressed={history} className={`rounded-lg px-3 py-1.5 ${history ? 'bg-accent/15 text-accent' : 'bg-surface'}`}>Resolved history</button></div><span>Last received error: {data.monitor.heartbeatAt ? time(data.monitor.heartbeatAt) : 'No new error received'}</span></div>
        <p className="text-xs text-muted">Alerts are sent only when a provider reports an error. No scheduled balance checks or call-history scans run in the background.</p>
        {!shown.length && <p className="py-3 text-sm text-muted">{history ? 'No resolved alerts yet.' : 'No unresolved service alerts. This does not verify provider credit balances.'}</p>}
        {shown.map(alert => <article key={alert.id} className="rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><AlertTriangle className={`h-4 w-4 shrink-0 ${alert.severity === 'CRITICAL' ? 'text-red-500' : 'text-amber-500'}`} />{alert.title}</h3><span className="rounded-full bg-background px-2 py-1 text-[10px] text-muted">{alert.status.replaceAll('_', ' ')} · {alert.severity}</span></div>
          <p className="mt-2 text-sm text-foreground">{alert.action}</p>
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted"><div><dt className="inline">First seen: </dt><dd className="inline">{time(alert.firstSeenAt)}</dd></div><div><dt className="inline">Last failure: </dt><dd className="inline">{time(alert.lastSeenAt)}</dd></div><div><dt className="inline">Affected call/check events: </dt><dd className="inline">{alert.occurrences}</dd></div></dl>
          <details className="mt-3 text-xs"><summary className="cursor-pointer text-accent">Provider error and affected calls</summary><p className="mt-2 break-words rounded-lg bg-background p-3 font-mono text-muted">{alert.message}</p><ul className="mt-2 space-y-1 text-muted">{alert.events.map(event => <li key={event.id}>{time(event.observedAt)} · {event.call ? `${event.call.customerName} · ${event.call.direction} · Call #${event.call.id}` : event.runId ? `Dograh run #${event.runId}` : 'Provider account check'}{event.runId && event.call ? ` · Run #${event.runId}` : ''}</li>)}</ul></details>
          {alert.status !== 'RESOLVED' && <div className="mt-3 flex flex-wrap gap-2">{alert.status === 'OPEN' && <button type="button" disabled={busy === alert.id} onClick={() => update(alert, 'acknowledge')} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground disabled:opacity-50"><Clock className="h-3 w-3" />Acknowledge</button>}<button type="button" disabled={busy === alert.id} onClick={() => update(alert, 'resolve')} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground disabled:opacity-50"><Check className="h-3 w-3" />Mark resolved after testing</button></div>}
        </article>)}
      </div>}
    </section>
  );
}
