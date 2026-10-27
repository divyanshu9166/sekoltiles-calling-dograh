'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { parseStoredButtons, toMetaTemplateName } from '@/lib/whatsapp/template-submission';
import {
  checkTemplateSubmission,
  EMPTY_SAMPLES,
  sampleNeeds,
  templateSubmitFormData,
  type TemplateDraft,
  type TemplateSamples,
} from '@/lib/whatsapp/template-samples';
import type { MessageTemplate } from '@/types';
import { TemplateSampleFields } from './template-sample-fields';

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
  const [samples, setSamples] = useState<TemplateSamples>(EMPTY_SAMPLES);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Start fresh each time a different template is opened.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setSamples(EMPTY_SAMPLES);
    setError('');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [template?.id]);

  const headerType = template?.header_type;
  const buttons = useMemo(() => parseStoredButtons(template?.buttons), [template?.buttons]);
  const draft: TemplateDraft | null = template ? { ...template, buttons } : null;
  const needs = sampleNeeds(draft ?? { body_text: '', buttons: [] });
  const metaName = template ? toMetaTemplateName(template.name) : '';

  async function handleSubmit() {
    if (!template || !draft) return;
    setError('');

    // Same checks the server runs, so most mistakes show up without a round trip.
    try {
      checkTemplateSubmission(draft, samples);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check the template and try again.');
      return;
    }

    const form = templateSubmitFormData(draft, samples);

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

            <TemplateSampleFields
              needs={needs}
              buttons={buttons}
              samples={samples}
              onChange={setSamples}
              disabled={submitting}
            />

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
