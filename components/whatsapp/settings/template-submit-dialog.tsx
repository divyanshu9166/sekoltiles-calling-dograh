'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { checkTemplateHeaderMedia, formatFileSize } from '@/lib/whatsapp/outbound-media';
import { isMediaHeaderType } from '@/lib/whatsapp/template-header';
import {
  buildTemplateCreatePayload,
  parseStoredButtons,
  toMetaCategory,
  toMetaTemplateName,
  variableCount,
  TemplateValidationError,
  type TemplateHeaderInput,
} from '@/lib/whatsapp/template-submission';
import type { MessageTemplate } from '@/types';

const HEADER_ACCEPT: Record<'image' | 'video' | 'document', string> = {
  image: 'image/jpeg,image/png',
  video: 'video/mp4',
  document: 'application/pdf',
};

const HEADER_FILE_LABEL: Record<'image' | 'video' | 'document', string> = {
  image: 'Sample photo (JPG or PNG)',
  video: 'Sample video (MP4)',
  document: 'Sample document (PDF)',
};

interface TemplateSubmitDialogProps {
  template: MessageTemplate | null;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => void;
}

/**
 * Collects the sample values Meta needs for every {{n}} variable (and a sample
 * file for media headers), then submits a Draft template for review.
 */
export function TemplateSubmitDialog({ template, onOpenChange, onSubmitted }: TemplateSubmitDialogProps) {
  const [headerExample, setHeaderExample] = useState('');
  const [bodyExamples, setBodyExamples] = useState<string[]>([]);
  const [buttonExamples, setButtonExamples] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Start fresh each time a different template is opened.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setHeaderExample('');
    setBodyExamples([]);
    setButtonExamples([]);
    setFile(null);
    setError('');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [template?.id]);

  const headerType = template?.header_type;
  const mediaHeader = isMediaHeaderType(headerType) ? headerType : null;
  const headerVars = headerType === 'text' ? variableCount(template?.header_content) : 0;
  const bodyVars = variableCount(template?.body_text);
  const buttons = useMemo(() => parseStoredButtons(template?.buttons), [template?.buttons]);
  const metaName = template ? toMetaTemplateName(template.name) : '';

  function buildArgs(handle: string) {
    if (!template) throw new TemplateValidationError('No template selected.');
    const category = toMetaCategory(template.category);
    if (!category) {
      throw new TemplateValidationError(
        'Authentication templates need Meta’s one-time-password setup. Create them in WhatsApp Manager, then sync.',
      );
    }
    let header: TemplateHeaderInput | null = null;
    if (headerType === 'text') {
      header = { format: 'TEXT', text: template.header_content ?? '', example: headerExample };
    } else if (mediaHeader) {
      header = { format: mediaHeader.toUpperCase() as 'IMAGE' | 'VIDEO' | 'DOCUMENT', handle };
    }
    return {
      name: metaName,
      language: template.language || 'en_US',
      category,
      header,
      body: template.body_text,
      bodyExamples,
      footer: template.footer_text,
      buttons: buttons.map((b, i) => (b.type === 'URL' ? { ...b, example: buttonExamples[i] ?? '' } : b)),
    };
  }

  async function handleSubmit() {
    if (!template) return;
    setError('');

    // Same checks the server runs, so most mistakes show up without a round trip.
    try {
      if (mediaHeader) {
        if (!file) throw new TemplateValidationError('Attach a sample file for the header so Meta can review it.');
        const check = checkTemplateHeaderMedia(mediaHeader, file);
        if (!check.ok) throw new TemplateValidationError(check.error);
      }
      buildTemplateCreatePayload(buildArgs('pending-upload'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check the template and try again.');
      return;
    }

    const form = new FormData();
    form.append('header_example', headerExample);
    form.append('body_examples', JSON.stringify(bodyExamples));
    form.append('button_examples', JSON.stringify(buttonExamples));
    if (mediaHeader && file) form.append('file', file);

    setSubmitting(true);
    try {
      const res = await fetch(`/api/whatsapp/templates/${template.id}/submit`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Submission failed (HTTP ${res.status})`);
        return;
      }
      toast.success(`${data?.data?.name ?? metaName} sent to Meta for review`);
      if (data?.data?.category && data.data.category !== template.category) {
        toast.info(`Meta filed it as ${data.data.category}, not ${template.category}.`);
      }
      onOpenChange(false);
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  const updateAt = (list: string[], index: number, value: string) => {
    const next = [...list];
    next[index] = value;
    return next;
  };

  return (
    <Dialog open={template !== null} onOpenChange={(open) => !submitting && onOpenChange(open)}>
      <DialogContent className="bg-surface border-border sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">Submit to Meta for review</DialogTitle>
          <DialogDescription className="text-muted">
            Meta needs a sample value for every variable. Review usually takes a few minutes and can take up to 24
            hours; the status here updates on its own.
          </DialogDescription>
        </DialogHeader>

        {template && (
          <div className="space-y-3.5 py-2">
            <div className="rounded-md border border-border px-3 py-2.5 space-y-1">
              <p className="text-xs text-muted">
                <span className="font-medium text-foreground">{metaName || template.name}</span> ·{' '}
                {template.category} · {template.language || 'en_US'}
              </p>
              {metaName && metaName !== template.name && (
                <p className="text-[11px] text-yellow-500">
                  Meta only allows lowercase letters, numbers and underscores, so it will be saved as {metaName}.
                </p>
              )}
              {headerType === 'text' && template.header_content && (
                <p className="text-sm font-medium text-foreground">{template.header_content}</p>
              )}
              <p className="text-sm text-foreground whitespace-pre-wrap">{template.body_text}</p>
              {template.footer_text && <p className="text-xs text-muted italic">{template.footer_text}</p>}
              {buttons.length > 0 && (
                <p className="text-xs text-muted">Buttons: {buttons.map((b) => b.text).join(' · ')}</p>
              )}
            </div>

            {mediaHeader && (
              <div className="space-y-1.5">
                <Label className="text-foreground text-xs sm:text-sm">{HEADER_FILE_LABEL[mediaHeader]}</Label>
                <Input
                  type="file"
                  accept={HEADER_ACCEPT[mediaHeader]}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <p className="text-[10px] sm:text-[11px] text-muted">
                  {file
                    ? `${file.name} · ${formatFileSize(file.size)}`
                    : 'Only used for Meta’s review. Each broadcast still attaches its own file.'}
                </p>
              </div>
            )}

            {headerVars > 0 && (
              <div className="space-y-1.5">
                <Label className="text-foreground text-xs sm:text-sm">Header sample for {'{{1}}'}</Label>
                <Input value={headerExample} onChange={(e) => setHeaderExample(e.target.value)} />
              </div>
            )}

            {Array.from({ length: bodyVars }, (_, i) => (
              <div key={`body-${i}`} className="space-y-1.5">
                <Label className="text-foreground text-xs sm:text-sm">Body sample for {`{{${i + 1}}}`}</Label>
                <Input
                  value={bodyExamples[i] ?? ''}
                  onChange={(e) => setBodyExamples(updateAt(bodyExamples, i, e.target.value))}
                />
              </div>
            ))}

            {buttons.map((button, i) =>
              button.type === 'URL' && variableCount(button.url) > 0 ? (
                <div key={`button-${i}`} className="space-y-1.5">
                  <Label className="text-foreground text-xs sm:text-sm">
                    Sample for {'{{1}}'} in “{button.text}”
                  </Label>
                  <Input
                    placeholder="e.g. summer-offer"
                    value={buttonExamples[i] ?? ''}
                    onChange={(e) => setButtonExamples(updateAt(buttonExamples, i, e.target.value))}
                  />
                  <p className="text-[10px] sm:text-[11px] text-muted break-all">{button.url}</p>
                </div>
              ) : null,
            )}

            {error && (
              <p role="alert" className="rounded-md border border-red-600/30 bg-red-600/10 px-3 py-2 text-xs text-red-400">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="border-border text-foreground hover:bg-surface-light"
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} className="bg-accent hover:bg-accent-hover text-white">
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                <Send className="size-4" />
                Submit to Meta
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
