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
  Paperclip,
} from "lucide-react";
import { useTemplateHeaderUpload, type HeaderMediaUpload } from "@/lib/whatsapp/use-template-header-upload";
import {
  hasSendNeeds,
  sendExtrasProblem,
  templateSendNeeds,
  type TemplateSendExtras,
} from "@/lib/whatsapp/template-send-extras";
import { TemplateSendExtrasFields } from "@/components/whatsapp/template-send-extras-fields";

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (
    template: MessageTemplate,
    params: string[],
    headerMedia?: HeaderMediaUpload,
    extras?: TemplateSendExtras,
  ) => Promise<boolean>;
}

const HEADER_LABEL = { image: "photo", video: "video", document: "PDF" } as const;
const HEADER_ACCEPT = { image: "image/jpeg,image/png", video: "video/mp4", document: "application/pdf,.pdf" } as const;

function mediaHeaderType(template: MessageTemplate | null) {
  const type = template?.header_type;
  return type === "image" || type === "video" || type === "document" ? type : null;
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
  const header = useTemplateHeaderUpload();
  const [extras, setExtras] = useState<TemplateSendExtras>({});
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
        const all = ((body.data ?? body.templates) as MessageTemplate[] | undefined) ?? [];
        setTemplates(all.filter((t) => t.status === "Approved"));
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
      setExtras({});
      header.reset();
    }
    onOpenChange(next);
  }

  async function sendTemplate(
    template: MessageTemplate,
    values: string[],
    headerMedia?: HeaderMediaUpload,
    sendExtras?: TemplateSendExtras,
  ) {
    if (sendInFlight.current) return;
    sendInFlight.current = true;
    const generation = openGeneration.current;
    setSending(true);
    try {
      const accepted = await onSelect(template, values, headerMedia, sendExtras);
      if (generation !== openGeneration.current) return;
      if (accepted) handleOpenChange(false);
      else setLoadError('Template was not sent. Review the error before retrying.');
    } catch { if (generation === openGeneration.current) setLoadError('Unable to send template. Please retry.'); }
    finally { sendInFlight.current = false; setSending(false); }
  }

  function pickTemplate(template: MessageTemplate) {
    if (sending || templatePickerProblem(template)) return;
    const vars = extractVariables(template.body_text);
    if (vars.length === 0 && !mediaHeaderType(template) && !hasSendNeeds(templateSendNeeds(template))) {
      void sendTemplate(template, []);
      return;
    }
    header.reset();
    setExtras({});
    setSelected(template);
    setParams(new Array(vars.length).fill(""));
  }

  function confirm() {
    if (!selected) return;
    void sendTemplate(selected, params, header.media ?? undefined, extras);
  }

  const variables = selected ? extractVariables(selected.body_text) : [];
  const headerType = mediaHeaderType(selected);
  const sendNeeds = selected ? templateSendNeeds(selected) : null;
  const extrasProblem = sendNeeds ? sendExtrasProblem(sendNeeds, extras) : null;
  const canConfirm =
    !!selected &&
    variables.every((_, i) => (params[i] ?? "").trim().length > 0) &&
    (!headerType || (!!header.media && !header.uploading)) &&
    !extrasProblem;

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
              ? "Fill in everything this template needs. Meta rejects a template with a missing variable or header."
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
            {headerType && (
              <div className="space-y-1">
                <Label className="text-xs text-foreground">{`Header ${HEADER_LABEL[headerType]}`}</Label>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border bg-surface-light px-3 py-2 text-xs text-muted hover:border-accent">
                  {header.uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                  <span className="truncate">
                    {header.uploading
                      ? "Uploading…"
                      : header.media
                        ? header.media.filename
                        : `Choose the ${HEADER_LABEL[headerType]} for this template`}
                  </span>
                  <input
                    type="file"
                    accept={HEADER_ACCEPT[headerType]}
                    className="hidden"
                    disabled={header.uploading || sending}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void header.upload(headerType, file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {header.error && <p className="text-xs text-warning">{header.error}</p>}
              </div>
            )}
            {sendNeeds && hasSendNeeds(sendNeeds) && (
              <TemplateSendExtrasFields needs={sendNeeds} extras={extras} onChange={setExtras} disabled={sending} />
            )}
            <div className="rounded-md border border-border bg-surface p-3">
              <p className="mb-1 text-xs text-muted">Preview</p>
              {header.media?.previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={header.media.previewUrl} alt="Header" className="mb-2 max-h-40 rounded-md object-cover" />
              )}
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
                  setExtras({});
                  header.reset();
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
