'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Broadcast, BroadcastRecipient, RecipientStatus } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowLeft,
  Loader2,
  Users,
  Send,
  CheckCheck,
  Eye,
  AlertCircle,
  MessageCircle,
  Filter,
  Download,
  ChevronDown,
  Trash2,
  CalendarClock,
  Ban,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getBroadcastStatus,
  getRecipientStatus,
} from '@/lib/broadcast-status';
import { formatIst } from '@/lib/whatsapp/ist-time';

interface StatCardProps {
  label: string;
  value: number;
  total: number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ label, value, total, icon, color }: StatCardProps) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
          {icon}
        </div>
        <span className="text-xs text-muted">{pct}%</span>
      </div>
      <p className="mt-3 text-2xl font-bold text-foreground">{value.toLocaleString()}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

interface FunnelStep {
  label: string;
  value: number;
  color: string;
}

// Pure CSS funnel chart: decreasing-width rounded bars.
// Width is relative to the largest step (typically Sent) so we
// always render a full bar at the top and proportional tails.
function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="glass-card p-4">
      <h3 className="mb-4 text-sm font-medium text-foreground">Funnel</h3>
      <div className="space-y-2">
        {steps.map((step) => {
          const pctOfMax = Math.max(5, Math.round((step.value / max) * 100));
          const pctOfSent =
            steps[0].value > 0
              ? Math.round((step.value / steps[0].value) * 100)
              : 0;
          return (
            <div key={step.label} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-muted">
                {step.label}
              </span>
              <div className="relative h-7 flex-1 rounded-full bg-surface-light">
                <div
                  className={`h-7 rounded-full ${step.color} transition-[width] duration-500`}
                  style={{ width: `${pctOfMax}%` }}
                />
                <span className="absolute inset-0 flex items-center px-3 text-xs font-medium text-white">
                  {step.value.toLocaleString()}
                  <span className="ml-2 opacity-70">
                    ({pctOfSent}%)
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const RECIPIENT_STATUSES: readonly RecipientStatus[] = [
  'pending',
  'sending',
  'sent',
  'delivered',
  'read',
  'replied',
  'failed',
  'skipped',
];

function countByStatus(recipients: BroadcastRecipient[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of recipients) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}

// CSV export helper - RFC 4180 quoting. Quote every field so
// commas, newlines, and quotes round-trip cleanly.
function toCsv(rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(escape).join(',')).join('\n');
}

function downloadBlob(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function BroadcastDetailPage() {
  const params = useParams();
  const router = useRouter();
  const broadcastId = params.id as string;

  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RecipientStatus | 'all'>('all');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Recipient counts by status, kept fresh by polling while the server sends.
  const [counts, setCounts] = useState<Record<string, number>>({});

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/whatsapp/broadcasts/${broadcastId}`, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error('Failed to load broadcast');
      }
      const data = await res.json();
      const rows: BroadcastRecipient[] = data.recipients ?? [];
      setBroadcast(data.broadcast);
      setRecipients(rows);
      setCounts(countByStatus(rows));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load broadcast');
    } finally {
      setLoading(false);
    }
  }, [broadcastId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  // The worker sends in the background; poll its progress while the
  // broadcast is scheduled or sending (slowly while it is only scheduled).
  const liveStatus = broadcast?.status === 'sending' || broadcast?.status === 'scheduled' ? broadcast.status : null;
  useEffect(() => {
    if (!liveStatus) return;
    let ticks = 0;
    const timer = setInterval(async () => {
      if (document.visibilityState === 'hidden') return;
      ticks++;
      try {
        const res = await fetch(`/api/whatsapp/broadcasts/${broadcastId}/progress`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        setBroadcast(data.broadcast);
        setCounts(data.counts ?? {});
        // Refresh the recipient table now and then, and once at the end.
        if (data.broadcast.status !== liveStatus || ticks % 5 === 0) fetchData();
      } catch {
        // Try again on the next tick.
      }
    }, liveStatus === 'sending' ? 3000 : 15000);
    return () => clearInterval(timer);
  }, [liveStatus, broadcastId, fetchData]);

  const filteredRecipients = useMemo(
    () =>
      statusFilter === 'all'
        ? recipients
        : recipients.filter((r) => r.status === statusFilter),
    [recipients, statusFilter],
  );

  function handleExport() {
    if (!broadcast) return;
    const header = [
      'Contact',
      'Phone',
      'Status',
      'Sent At',
      'Delivered At',
      'Read At',
      'Replied At',
      'Error',
    ];
    const rows = recipients.map((r) => [
      r.contact?.name ?? '',
      r.contact?.phone ?? '',
      r.status,
      r.sent_at ?? '',
      r.delivered_at ?? '',
      r.read_at ?? '',
      r.replied_at ?? '',
      r.error_message ?? '',
    ]);
    const csv = toCsv([header, ...rows]);
    const safeName = broadcast.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    downloadBlob(`broadcast-${safeName}-${broadcastId.slice(0, 8)}.csv`, csv);
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/whatsapp/broadcasts/${broadcastId}/cancel`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to cancel broadcast');
      }
      toast.success(broadcast?.status === 'scheduled' ? 'Broadcast cancelled' : 'Broadcast stopped');
      setConfirmCancel(false);
      await fetchData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCancelling(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/whatsapp/broadcasts/${broadcastId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error('Failed to delete broadcast');
      }
      toast.success('Broadcast deleted');
      router.push('/whatsapp-marketing?tab=broadcasts');
    } catch (err: any) {
      toast.error(`Failed to delete: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
      </div>
    );
  }

  if (error || !broadcast) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error ?? 'Broadcast not found'}</p>
        <Button variant="outline" onClick={() => router.push('/whatsapp-marketing?tab=broadcasts')}>
          Back to Broadcasts
        </Button>
      </div>
    );
  }

  const status = getBroadcastStatus(broadcast.status);
  const progressTotal = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const progressDone = progressTotal - (counts.pending ?? 0) - (counts.sending ?? 0);
  const skippedCount = counts.skipped ?? 0;

  const funnelSteps: FunnelStep[] = [
    { label: 'Sent', value: broadcast.sent_count, color: 'bg-violet-500' },
    { label: 'Delivered', value: broadcast.delivered_count, color: 'bg-teal-500' },
    { label: 'Read', value: broadcast.read_count, color: 'bg-blue-500' },
    { label: 'Replied', value: broadcast.replied_count, color: 'bg-indigo-500' },
  ];

  return (
    <div className="wa-light space-y-6">
      {/* Header */}
      <div className="ui-page-header flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push('/whatsapp-marketing?tab=broadcasts')}
            className="border-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{broadcast.name}</h1>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
              >
                {status.label}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted">
              <span>Template: {broadcast.template_name}</span>
              <span>-</span>
              <span>
                Created {new Date(broadcast.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        {/* Delete - inline-confirm pattern matches the pipeline settings flow.
            Mid-send broadcasts cannot be deleted to avoid orphaned status. */}
        {confirmDelete ? (
          <div className="ui-actions flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm">
            <span className="text-red-300">Delete this broadcast?</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="h-7 border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
              className="h-7 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Confirm'}
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={broadcast.status === 'sending'}
            onClick={() => setConfirmDelete(true)}
            title={
              broadcast.status === 'sending'
                ? 'Cannot delete while a broadcast is actively sending'
                : 'Delete this broadcast'
            }
            className="border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        )}
      </div>

      {/* Scheduled / sending: runs on the server, so this tab can be closed. */}
      {(broadcast.status === 'scheduled' || broadcast.status === 'sending') && (
        <div className="glass-card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {broadcast.status === 'scheduled' ? (
                <CalendarClock className="h-4 w-4 text-blue-400" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-accent" />
              )}
              <p className="text-sm font-medium text-foreground">
                {broadcast.status === 'scheduled'
                  ? `Scheduled for ${broadcast.scheduled_at ? formatIst(broadcast.scheduled_at) : 'later'}`
                  : `Sending: ${progressDone.toLocaleString()} of ${progressTotal.toLocaleString()} done`}
              </p>
            </div>
            {confirmCancel ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted">
                  {broadcast.status === 'scheduled' ? 'Cancel this broadcast?' : 'Stop sending to the rest?'}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmCancel(false)}
                  disabled={cancelling}
                  className="h-7 border-border"
                >
                  No
                </Button>
                <Button
                  size="sm"
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="h-7 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {cancelling ? 'Working...' : 'Yes'}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmCancel(true)}
                className="border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10"
              >
                <Ban className="h-3.5 w-3.5" />
                {broadcast.status === 'scheduled' ? 'Cancel broadcast' : 'Stop sending'}
              </Button>
            )}
          </div>
          {broadcast.status === 'sending' && (
            <div className="h-1.5 w-full rounded-full bg-surface-light">
              <div
                className="h-1.5 rounded-full bg-accent transition-all duration-500"
                style={{ width: `${progressTotal ? Math.round((progressDone / progressTotal) * 100) : 0}%` }}
              />
            </div>
          )}
          <p className="text-xs text-muted">
            This runs on the server: you can close this tab.
            {broadcast.status === 'scheduled' && ' Customers who opt out before the send time are skipped.'}
          </p>
        </div>
      )}

      {broadcast.error_message && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{broadcast.error_message}</p>
        </div>
      )}

      {skippedCount > 0 && (
        <p className="text-xs text-muted">
          {skippedCount.toLocaleString()} recipient{skippedCount === 1 ? ' was' : 's were'} skipped
          (opted out of marketing, or the broadcast was cancelled).
        </p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Total Recipients"
          value={broadcast.total_recipients}
          total={broadcast.total_recipients}
          icon={<Users className="h-4 w-4" />}
          color="bg-slate-800 text-slate-300"
        />
        <StatCard
          label="Sent"
          value={broadcast.sent_count}
          total={broadcast.total_recipients}
          icon={<Send className="h-4 w-4" />}
          color="bg-violet-500/10 text-violet-400"
        />
        <StatCard
          label="Delivered"
          value={broadcast.delivered_count}
          total={broadcast.total_recipients}
          icon={<CheckCheck className="h-4 w-4" />}
          color="bg-teal-500/10 text-teal-400"
        />
        <StatCard
          label="Read"
          value={broadcast.read_count}
          total={broadcast.total_recipients}
          icon={<Eye className="h-4 w-4" />}
          color="bg-blue-500/10 text-blue-400"
        />
        <StatCard
          label="Replied"
          value={broadcast.replied_count}
          total={broadcast.total_recipients}
          icon={<MessageCircle className="h-4 w-4" />}
          color="bg-indigo-500/10 text-indigo-400"
        />
        <StatCard
          label="Failed"
          value={broadcast.failed_count}
          total={broadcast.total_recipients}
          icon={<AlertCircle className="h-4 w-4" />}
          color="bg-red-500/10 text-red-400"
        />
      </div>

      <FunnelChart steps={funnelSteps} />

      {/* Recipients Table */}
      <div className="glass-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">
            Recipients ({filteredRecipients.length}
            {statusFilter !== 'all' ? ` of ${recipients.length}` : ''})
          </h2>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-700 text-slate-300 hover:bg-slate-800"
                  />
                }
              >
                <Filter className="h-3.5 w-3.5" />
                {statusFilter === 'all'
                  ? 'All statuses'
                  : getRecipientStatus(statusFilter).label}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="border-slate-700 bg-slate-900">
                <DropdownMenuItem
                  onClick={() => setStatusFilter('all')}
                  className={
                    statusFilter === 'all' ? 'text-violet-400' : 'text-slate-300'
                  }
                >
                  All statuses
                </DropdownMenuItem>
                {RECIPIENT_STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={
                      statusFilter === s
                        ? 'text-violet-400'
                        : 'text-slate-300'
                    }
                  >
                    {getRecipientStatus(s).label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={recipients.length === 0}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
        </div>

        {filteredRecipients.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-slate-400">
              {recipients.length === 0
                ? 'No recipients found.'
                : 'No recipients match this filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400">Contact</TableHead>
                  <TableHead className="text-slate-400">Phone</TableHead>
                  <TableHead className="text-slate-400">Status</TableHead>
                  <TableHead className="text-slate-400">Sent</TableHead>
                  <TableHead className="text-slate-400">Delivered</TableHead>
                  <TableHead className="text-slate-400">Read</TableHead>
                  <TableHead className="text-slate-400">Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecipients.map((recipient) => {
                  const rStatus = getRecipientStatus(recipient.status);
                  return (
                    <TableRow key={recipient.id} className="border-slate-800">
                      <TableCell className="font-medium text-white">
                        {recipient.contact?.name ?? 'Unknown'}
                      </TableCell>
                      <TableCell className="text-slate-300">
                        {recipient.contact?.phone ?? '-'}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${rStatus.classes}`}
                        >
                          {rStatus.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-slate-400">
                        {recipient.sent_at
                          ? new Date(recipient.sent_at).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell className="text-slate-400">
                        {recipient.delivered_at
                          ? new Date(recipient.delivered_at).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell className="text-slate-400">
                        {recipient.read_at
                          ? new Date(recipient.read_at).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-red-400">
                        {recipient.error_message ?? '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
