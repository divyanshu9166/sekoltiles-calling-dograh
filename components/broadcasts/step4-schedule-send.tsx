'use client';

import { useEffect, useState } from 'react';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ArrowLeft, Send, Loader2, Users, Save, CalendarClock } from 'lucide-react';
import { dateToIstInput, formatIst, istInputToDate } from '@/lib/whatsapp/ist-time';
import { scheduleTooFarError } from '@/lib/whatsapp/broadcast-schedule';
import type { VariableMapping } from '@/lib/whatsapp/broadcast-variables';

type AudienceType = 'all' | 'tags' | 'custom_field' | 'csv' | 'manual';
type CustomFieldOperator = 'is' | 'is_not' | 'contains';

interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

interface AudienceConfig {
  type: AudienceType;
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  selectedContactIds?: string[];
  excludeTagIds?: string[];
}

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  /** `scheduledAt` is set when the user chose to send later. */
  onSend: (scheduledAt?: Date) => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  /** The template's header photo/video/PDF is attached (limits how far ahead it can be scheduled). */
  hasHeaderMedia?: boolean;
  /** Step 3's {{n}} mapping, to warn about contacts whose value is empty. */
  variables?: Record<string, VariableMapping>;
}

interface BlankVariable {
  key: string;
  count: number;
  source: string;
}

/** One hour from now, rounded up to the next quarter hour, in IST. */
function defaultScheduleInput() {
  const quarter = 15 * 60 * 1000;
  return dateToIstInput(new Date(Math.ceil((Date.now() + 60 * 60 * 1000) / quarter) * quarter));
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  onSend,
  onSaveDraft,
  onBack,
  isProcessing,
  hasHeaderMedia = false,
  variables,
}: Step4Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [scheduleInput, setScheduleInput] = useState(defaultScheduleInput);
  // Ticks so a time that slips into the past while the page is open is caught.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const scheduledAt = when === 'later' ? istInputToDate(scheduleInput.date, scheduleInput.time) : null;
  const scheduleError =
    when !== 'later'
      ? null
      : !scheduledAt
        ? 'Pick a date and time.'
        : scheduledAt.getTime() < nowMs + 60_000
          ? 'Pick a time at least a minute from now.'
          : scheduleTooFarError(scheduledAt.getTime(), nowMs, hasHeaderMedia);
  const canSend = !!name.trim() && !isProcessing && !scheduleError;
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
  const [optedOutCount, setOptedOutCount] = useState(0);
  const [blankContacts, setBlankContacts] = useState(0);
  const [blankVariables, setBlankVariables] = useState<BlankVariable[]>([]);
  const [loadingReach, setLoadingReach] = useState(true);

  useEffect(() => {
    async function calculateReach() {
      setLoadingReach(true);
      try {
        if (audience.type === 'csv' && audience.csvContacts && audience.csvContacts.length > 0) {
          setEstimatedReach(audience.csvContacts.length);
          return;
        }

        const res = await fetch('/api/whatsapp/broadcasts/audience-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audience, variables })
        });

        if (res.ok) {
          const { count, opted_out, blank_contacts, blank_variables } = await res.json();
          setEstimatedReach(count ?? 0);
          setOptedOutCount(opted_out ?? 0);
          setBlankContacts(blank_contacts ?? 0);
          setBlankVariables(Array.isArray(blank_variables) ? blank_variables : []);
        } else {
          setEstimatedReach(0);
        }
      } catch {
        setEstimatedReach(0);
      } finally {
        setLoadingReach(false);
      }
    }

    calculateReach();
  }, [audience, variables]);

  const audienceLabel =
    audience.type === 'all'
      ? 'All Contacts'
      : audience.type === 'tags'
        ? `Tags (${audience.tagIds?.length ?? 0} selected)`
        : audience.type === 'manual'
          ? `Selected Contacts (${audience.selectedContactIds?.length ?? 0})`
          : audience.type === 'csv'
            ? 'CSV Upload'
            : 'Custom Field';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Review and Send</h2>
        <p className="mt-1 text-sm text-muted">
          Name your broadcast, review the details, and send it now or schedule it.
        </p>
      </div>

      {/* Broadcast Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">Broadcast Name</label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Summer Sale Announcement"
        />
      </div>

      {/* Summary Card */}
      <div className="glass-card p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">Summary</p>
        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-xs text-muted">Template</p>
            <p className="mt-1 leading-6 text-foreground [overflow-wrap:anywhere]">{template.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Audience</p>
            <p className="text-foreground">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Estimated Reach</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="h-3 w-3 animate-spin text-accent" />
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-accent" />
                  <p className="font-medium text-foreground">{estimatedReach.toLocaleString()}</p>
                  {optedOutCount > 0 && (
                    <span className="text-xs text-muted" title="These customers replied STOP or turned off marketing messages">
                      ({optedOutCount.toLocaleString()} opted out, skipped)
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted">Language</p>
            <p className="text-foreground">{template.language ?? 'en_US'}</p>
          </div>
        </div>
      </div>

      {!loadingReach && blankContacts > 0 && (
        <div role="alert" className="rounded-md border border-warning/30 bg-warning-light px-3 py-2.5 text-sm text-warning space-y-1">
          <p className="font-medium">
            {blankContacts === estimatedReach
              ? `All ${estimatedReach.toLocaleString()} contacts are missing a template value, so nobody would get this broadcast.`
              : `${blankContacts.toLocaleString()} of ${estimatedReach.toLocaleString()} contacts are missing a template value. They will be skipped, not sent.`}
          </p>
          <ul className="list-disc pl-5 text-xs">
            {blankVariables.map((v) => (
              <li key={v.key}>
                {`{{${v.key}}}`} ({v.source}) is empty for {v.count.toLocaleString()} contact{v.count !== 1 ? 's' : ''}
              </li>
            ))}
          </ul>
          <p className="text-xs">
            WhatsApp rejects a template with an empty value. Go back and map it to a field every contact has (e.g.
            Contact Name), or use a static value.
          </p>
        </div>
      )}

      {/* When to send */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">When to send</p>
        <div className="inline-flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="When to send">
          {(['now', 'later'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={when === option}
              onClick={() => setWhen(option)}
              disabled={isProcessing}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                when === option ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
              }`}
            >
              {option === 'now' ? 'Send now' : 'Schedule'}
            </button>
          ))}
        </div>
        {when === 'later' && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                aria-label="Send date (IST)"
                value={scheduleInput.date}
                min={dateToIstInput(new Date(nowMs)).date}
                onChange={(e) => setScheduleInput((s) => ({ ...s, date: e.target.value }))}
                className="w-auto"
              />
              <Input
                type="time"
                aria-label="Send time (IST)"
                value={scheduleInput.time}
                onChange={(e) => setScheduleInput((s) => ({ ...s, time: e.target.value }))}
                className="w-auto"
              />
              <span className="text-sm text-muted">IST</span>
            </div>
            {scheduleError ? (
              <p className="text-xs text-red-400">{scheduleError}</p>
            ) : (
              scheduledAt && (
                <p className="text-xs text-muted">
                  Sends on {formatIst(scheduledAt)}. Customers who opt out before then are skipped.
                </p>
              )
            )}
          </div>
        )}
      </div>

      {isProcessing && (
        <div className="flex items-center gap-2 rounded-xl border border-accent/20 bg-accent-light p-4">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          <p className="text-sm font-medium text-foreground">
            {when === 'later' ? 'Scheduling broadcast...' : 'Starting broadcast...'}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-border text-muted"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-border text-muted disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Save as Draft
            </Button>
          )}

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
            <DialogTrigger
              render={
                <Button
                  disabled={!canSend}
                  className="bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
                />
              }
            >
              {when === 'later' ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {when === 'later' ? 'Schedule Broadcast' : 'Send Broadcast'}
            </DialogTrigger>
            <DialogContent className="min-w-0 max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
              <DialogHeader className="min-w-0 pr-6">
                <DialogTitle className="text-foreground">
                  {when === 'later' ? 'Confirm Schedule' : 'Confirm Broadcast'}
                </DialogTitle>
                <DialogDescription className="leading-6 text-muted [overflow-wrap:anywhere]">
                  {when === 'later' && scheduledAt ? (
                    <>
                      This broadcast will go to about{' '}
                      <span className="font-medium text-foreground">{estimatedReach.toLocaleString()}</span>{' '}
                      contacts on{' '}
                      <span className="font-medium text-foreground">{formatIst(scheduledAt)}</span>.
                      You can cancel it until then.
                    </>
                  ) : (
                    <>
                      You are about to send this broadcast to{' '}
                      <span className="font-medium text-foreground">{estimatedReach.toLocaleString()}</span>{' '}
                      contacts.
                      It keeps sending even if you close this tab.
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="min-w-0 rounded-lg border border-border bg-surface-light p-3">
                <p className="mb-1 text-xs font-medium text-muted">Selected template</p>
                <p className="text-sm font-medium leading-6 text-foreground [overflow-wrap:anywhere]">{template.name}</p>
              </div>
              <DialogFooter className="min-w-0">
                <Button
                  variant="outline"
                  onClick={() => setShowConfirm(false)}
                  className="w-full border-border text-muted sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setShowConfirm(false);
                    onSend(scheduledAt ?? undefined);
                  }}
                  disabled={!canSend}
                  className="w-full bg-accent text-white hover:bg-accent-hover sm:w-auto"
                >
                  {when === 'later' ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                  {when === 'later' ? 'Confirm and Schedule' : 'Confirm and Send'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
