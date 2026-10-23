'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Where a secret is read from on the server (see lib/whatsapp/saved-secrets.ts). */
export type SecretSource = 'settings' | 'env' | 'none';

interface SavedSecretFieldProps {
  label: string;
  placeholder: string;
  hint: string;
  /** PATCH endpoint that accepts `{ [field]: string | null }` and returns `{ source }`. */
  endpoint: string;
  field: string;
  /** null while the current source is still loading. */
  source: SecretSource | null;
  status: Record<SecretSource, string>;
  /** Shown instead of the hint, and disables the field, when saving isn't possible yet. */
  disabledReason?: string | null;
  onSourceChange: (source: SecretSource) => void;
}

/**
 * Write-only secret input: the saved value is never sent back to the browser,
 * only whether it comes from Settings, the server .env, or nowhere.
 */
export function SavedSecretField({
  label,
  placeholder,
  hint,
  endpoint,
  field,
  source,
  status,
  disabledReason,
  onSourceChange,
}: SavedSecretFieldProps) {
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const disabled = Boolean(disabledReason) || busy !== null;

  async function submit(next: string | null) {
    setBusy(next === null ? 'remove' : 'save');
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next === null ? null : next.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Failed to ${next === null ? 'remove' : 'save'} ${label}`);
        return;
      }
      setValue('');
      setShow(false);
      if (data.source) onSourceChange(data.source as SecretSource);
      toast.success(next === null ? `${label} removed` : `${label} saved`);
    } catch {
      toast.error(`Failed to ${next === null ? 'remove' : 'save'} ${label}`);
    } finally {
      setBusy(null);
    }
  }

  const StatusIcon = source === 'settings' ? CheckCircle2 : source === 'env' ? Server : AlertTriangle;

  return (
    <div className="space-y-1.5">
      <Label className="text-foreground text-xs sm:text-sm">{label}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <Input
            type={show ? 'text' : 'password'}
            autoComplete="off"
            placeholder={source === 'settings' ? 'Saved — enter a new value to replace it' : placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim() && !disabled) submit(value);
            }}
            disabled={disabled}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            aria-label={show ? `Hide ${label}` : `Show ${label}`}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors p-1"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Button
          onClick={() => submit(value)}
          disabled={disabled || !value.trim()}
          className="bg-accent hover:bg-accent-hover text-white shrink-0"
        >
          {busy === 'save' ? <Loader2 className="size-4 animate-spin" /> : 'Save'}
        </Button>
      </div>

      {source && (
        <p className={`flex items-start gap-1.5 text-[11px] ${source === 'none' ? 'text-amber-600' : 'text-muted'}`}>
          <StatusIcon className={`size-3.5 shrink-0 mt-px ${source === 'settings' ? 'text-green-600' : ''}`} />
          <span>{status[source]}</span>
        </p>
      )}
      {source === 'settings' && (
        <button
          type="button"
          onClick={() => submit(null)}
          disabled={busy !== null}
          className="text-[11px] font-medium text-red-600 hover:underline disabled:opacity-60"
        >
          {busy === 'remove' ? 'Removing…' : 'Remove saved value'}
        </button>
      )}
      <p className="text-[11px] text-muted">{disabledReason || hint}</p>
    </div>
  );
}
