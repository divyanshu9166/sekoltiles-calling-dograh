"use client";

import { useEffect, useState, useRef } from "react";
import { templatePickerProblem } from '@/lib/whatsapp/inbox-state';
import type { MessageTemplate } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ChevronRight,
  LayoutTemplate,
  Loader2,
} from "lucide-react";

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: MessageTemplate, params: string[]) => Promise<boolean>;
}

// Meta numbers template placeholders from 1 ({{1}}, {{2}}, …) and the
// indices passed to the Graph API must be contiguous starting at 1.
// Validation rejects gaps/named variables; sorting keeps input/send order aligned.
function extractVariables(body: string): number[] {
  const ids = new Set<number>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    ids.add(Number(m[1]));
  }
  return Array.from(ids).sort((a, b) => a - b);
}

function renderBodyPreview(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    const value = params[idx];
    return value && value.trim().length > 0 ? value : `{{${raw}}}`;
  });
}

export function TemplatePicker({
  open,
  onOpenChange,
  onSelect,
}: TemplatePickerProps) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [sending, setSending] = useState(false);
  const sendInFlight = useRef(false);
  const openGeneration = useRef(0);
  useEffect(() => { openGeneration.current += 1; }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
      // Only Approved templates are sendable through Meta — anything else
      // would 400 on the send route. Hide them rather than letting the
      // user pick a template that will be rejected.
      const res = await fetch('/api/whatsapp/templates?status=Approved', {
        cache: 'no-store',
      });

      if (cancelled) return;
      if (!res.ok) {
        throw new Error('Unable to load approved templates');
      } else {
        const body = await res.json();
        if (cancelled) return;
        setTemplates((body.templates as MessageTemplate[]) ?? []);
        setLoadError('');
      }
      } catch { if (!cancelled) setLoadError('Unable to load templates. Please retry.'); }
      finally { if (!cancelled) setLoading(false); }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, reloadToken]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSelected(null);
      setParams([]);
    }
    onOpenChange(next);
  }

  async function sendTemplate(template: MessageTemplate, values: string[]) {
    if (sendInFlight.current) return;
    sendInFlight.current = true;
    const generation = openGeneration.current;
    setSending(true);
    try {
      const accepted = await onSelect(template, values);
      if (generation !== openGeneration.current) return;
      if (accepted) handleOpenChange(false);
      else setLoadError('Template was not sent. Review the error before retrying.');
    } catch { if (generation === openGeneration.current) setLoadError('Unable to send template. Please retry.'); }
    finally { sendInFlight.current = false; setSending(false); }
  }

  function pickTemplate(template: MessageTemplate) {
    if (sending || templatePickerProblem(template)) return;
    const vars = extractVariables(template.body_text);
    if (vars.length === 0) {
      void sendTemplate(template, []);
      return;
    }
    setSelected(template);
    setParams(new Array(vars.length).fill(""));
  }

  function confirm() {
    if (!selected) return;
    void sendTemplate(selected, params);
  }

  const variables = selected ? extractVariables(selected.body_text) : [];
  const canConfirm =
    !!selected &&
    variables.every((_, i) => (params[i] ?? "").trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="wa-template-picker border-border bg-surface sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <LayoutTemplate className="h-4 w-4 text-accent" />
            {selected ? selected.name : "Send template"}
          </DialogTitle>
          <DialogDescription className="text-muted">
            {selected
              ? "Fill in the placeholders to render this template. Meta requires every variable to be set."
              : "Pick an approved WhatsApp template to send to this contact."}
          </DialogDescription>
        </DialogHeader>
        {loadError && <div role="alert" className="rounded-lg bg-warning-light p-3 text-xs text-warning">{loadError} <button type="button" disabled={sending} onClick={() => setReloadToken(value => value + 1)} className="ml-2 rounded-lg border border-border px-2 py-2">Retry loading</button></div>}

        {!selected ? (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-accent" />
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-md border border-border bg-surface p-6 text-center">
                <p className="text-sm text-foreground">No approved templates</p>
                <p className="mt-1 text-xs text-muted">
                  Approve a template in Meta WhatsApp Manager, then sync it
                  from Settings → Templates.
                </p>
              </div>
            ) : (
              templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickTemplate(t)}
                  disabled={sending || !!templatePickerProblem(t)}
                  className="w-full rounded-md border border-border bg-surface p-3 text-left transition-colors hover:border-accent hover:bg-surface"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {t.name}
                        </p>
                        <Badge className="border border-accent/20 bg-accent-light text-[10px] text-accent">
                          {t.category}
                        </Badge>
                        {t.language && (
                          <span className="text-[10px] uppercase text-muted">
                            {t.language}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted">
                        {t.body_text}
                      </p>
                      {templatePickerProblem(t) && <p className="mt-1 text-xs text-warning">{templatePickerProblem(t)}</p>}
                    </div>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted" />
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-surface p-3">
              <p className="mb-1 text-xs text-muted">Preview</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {renderBodyPreview(selected.body_text, params)}
              </p>
              {selected.footer_text && (
                <p className="mt-2 text-xs italic text-muted">
                  {selected.footer_text}
                </p>
              )}
            </div>
            {variables.map((v, i) => (
              <div key={v} className="space-y-1">
                <Label className="text-xs text-foreground">{`Variable {{${v}}}`}</Label>
                <Input
                  value={params[i] ?? ""}
                  onChange={(e) => {
                    const next = [...params];
                    next[i] = e.target.value;
                    setParams(next);
                  }}
                  placeholder={`Value for {{${v}}}`}
                  className="border-border bg-surface-light text-foreground placeholder:text-muted"
                />
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          {selected ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setSelected(null);
                  setParams([]);
                }}
                className="border-border text-foreground hover:bg-surface-light"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                disabled={!canConfirm || sending}
                onClick={confirm}
                className="wa-send-button bg-accent hover:bg-accent disabled:opacity-50"
              >
                Send template
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-border text-foreground hover:bg-surface-light"
            >
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
