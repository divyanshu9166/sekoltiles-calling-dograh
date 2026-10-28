'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Loader2, RefreshCw, Send, X } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MessageTemplate } from '@/types';
import { TEMPLATE_LIMITS, type TemplateButtonInput } from '@/lib/whatsapp/template-submission';
import {
  checkTemplateSubmission,
  EMPTY_SAMPLES,
  hasSampleNeeds,
  sampleNeeds,
  templateSubmitFormData,
  type TemplateDraft,
  type TemplateSamples,
} from '@/lib/whatsapp/template-samples';
import { TemplateSubmitDialog } from './template-submit-dialog';
import { TemplateSampleFields } from './template-sample-fields';
import { TemplateButtonEditor } from './template-button-editor';
import { TemplateTextToolbar } from './template-text-toolbar';
import { TemplatePreview } from './template-preview';

const CATEGORIES = ['Marketing', 'Utility', 'Authentication'] as const;
const HEADER_TYPES = ['text', 'image', 'video', 'document', 'location'] as const;
// Labels for the selected value too; without them the box shows "video".
const HEADER_TYPE_ITEMS = [
  { value: 'none', label: 'None' },
  ...HEADER_TYPES.map((type) => ({ value: type, label: type.charAt(0).toUpperCase() + type.slice(1) })),
];

const categoryColors: Record<string, string> = {
  Marketing: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
  Utility: 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  Authentication: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
};

const statusColors: Record<string, string> = {
  Draft: 'bg-border text-muted border-border',
  Pending: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
  Approved: 'bg-accent text-accent border-accent',
  Rejected: 'bg-red-600/20 text-red-400 border-red-600/30',
};

interface TemplateFormData {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  body_text: string;
  header_type: string;
  header_content: string;
  footer_text: string;
  buttons: TemplateButtonInput[];
}

// Meta's language codes are exact — "en" and "en_US" are distinct and a
// template approved under one will be rejected if you send with the other
// (Graph API error #132001 "Template name does not exist in the
// translation"). Default to en_US to match the DB default on
// message_templates.language and the broadcasts sender's fallback.
const emptyForm: TemplateFormData = {
  name: '',
  category: 'Marketing',
  language: 'en_US',
  body_text: '',
  header_type: '',
  header_content: '',
  footer_text: '',
  buttons: [],
};

/** Meta template names: lowercase letters, numbers and underscores only. */
function typedTemplateName(value: string) {
  return value.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// Common Meta template language codes. The field still accepts any
// string — this just offers autocomplete for the usual suspects. Full
// list: https://developers.facebook.com/docs/whatsapp/api/messages/message-templates#supported-languages
const COMMON_LANGUAGE_CODES = [
  'en_US',
  'en_GB',
  'en',
  'es',
  'es_ES',
  'es_MX',
  'fr',
  'fr_FR',
  'de',
  'it',
  'pt_BR',
  'pt_PT',
  'nl',
  'pl',
  'ru',
  'tr',
  'lt',
];

export function TemplateManager() {
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState<TemplateFormData>(emptyForm);
  const [samples, setSamples] = useState<TemplateSamples>(EMPTY_SAMPLES);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitTarget, setSubmitTarget] = useState<MessageTemplate | null>(null);
  const headerTextRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);

      const res = await fetch('/api/whatsapp/templates', { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to load templates');
      }

      setTemplates(payload.data || []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      toast.error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    fetchTemplates();
  }, [authLoading, user, fetchTemplates]);

  /** What gets stored, trimmed the same way for both buttons. */
  function draftFromForm(): TemplateDraft {
    return {
      name: form.name.trim(),
      category: form.category,
      language: form.language.trim() || 'en_US',
      body_text: form.body_text.trim(),
      header_type: form.header_type && form.header_type !== 'none' ? form.header_type : null,
      header_content: form.header_type === 'text' ? form.header_content.trim() || null : null,
      footer_text: form.footer_text.trim() || null,
      buttons: form.buttons.map((b) => ({
        type: b.type,
        text: b.type === 'COPY_CODE' ? '' : b.text.trim(),
        ...(b.type === 'URL' ? { url: (b.url ?? '').trim() } : {}),
        ...(b.type === 'PHONE_NUMBER' ? { phone_number: (b.phone_number ?? '').trim() } : {}),
        ...(b.type === 'COPY_CODE' ? { example: (b.example ?? '').trim() } : {}),
        ...(b.type === 'FLOW'
          ? { flow_id: (b.flow_id ?? '').trim(), ...(b.navigate_screen?.trim() ? { navigate_screen: b.navigate_screen.trim() } : {}) }
          : {}),
      })),
    };
  }

  function openNewTemplate() {
    setForm(emptyForm);
    setSamples(EMPTY_SAMPLES);
    setFormError('');
    setDialogOpen(true);
  }

  function closeNewTemplate() {
    setDialogOpen(false);
    setForm(emptyForm);
    setSamples(EMPTY_SAMPLES);
    setFormError('');
  }

  async function createDraft(draft: TemplateDraft): Promise<MessageTemplate> {
    const res = await fetch('/api/whatsapp/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...draft, status: 'Draft' as const }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Failed to create template');
    return data.data as MessageTemplate;
  }

  function basicProblem(): string | null {
    if (!form.name.trim()) return 'Template name is required';
    if (!form.body_text.trim()) return 'Body text is required';
    return null;
  }

  async function handleSave() {
    const problem = basicProblem();
    if (problem) {
      toast.error(problem);
      return;
    }
    if (!user) {
      toast.error('Not authenticated');
      return;
    }

    try {
      setSaving(true);
      await createDraft(draftFromForm());
      toast.success('Template saved as a draft');
      closeNewTemplate();
      await fetchTemplates();
    } catch (err) {
      console.error('Save error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to create template');
    } finally {
      setSaving(false);
    }
  }

  /**
   * Save the template and send it to Meta for review in one go, like
   * WhatsApp Manager. If Meta refuses it, the just-saved draft is removed
   * again so the form can be fixed and retried without a duplicate row.
   */
  async function handleSaveAndSubmit() {
    setFormError('');
    const problem = basicProblem();
    if (problem) {
      setFormError(problem);
      return;
    }
    if (!user) {
      toast.error('Not authenticated');
      return;
    }
    const draft = draftFromForm();
    try {
      checkTemplateSubmission(draft, samples);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Check the template and try again.');
      return;
    }

    setSubmitting(true);
    let created: MessageTemplate | null = null;
    try {
      created = await createDraft(draft);
      const res = await fetch(`/api/whatsapp/templates/${created.id}/submit`, {
        method: 'POST',
        body: templateSubmitFormData(draft, samples),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status >= 500 && res.status !== 502) {
        // Our server failed after the request may have reached Meta.
        throw new Error(data?.error || `Submission failed (HTTP ${res.status})`);
      }
      if (!res.ok) {
        // Meta (502) or our checks (4xx) refused it: drop the draft so a
        // retry doesn't leave a second copy behind.
        await fetch(`/api/whatsapp/templates/${created.id}`, { method: 'DELETE' }).catch(() => {});
        setFormError(data?.error || `Submission failed (HTTP ${res.status})`);
        return;
      }
      toast.success(`${data?.data?.name ?? draft.name} sent to Meta for review`);
      if (data?.data?.category && data.data.category !== draft.category) {
        toast.info(`Meta filed it as ${data.data.category}, not ${draft.category}.`);
      }
      closeNewTemplate();
      await fetchTemplates();
    } catch (err) {
      console.error('Save & submit error:', err);
      if (created) {
        // The draft is saved but we don't know whether Meta got it.
        toast.error('Saved as a draft, but the submission did not finish. Check its status, or Sync from Meta.');
        closeNewTemplate();
        await fetchTemplates();
      } else {
        setFormError(err instanceof Error ? err.message : 'Failed to create template');
      }
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Pull approved templates from Meta and upsert them into the local
   * catalog. After this runs, every local row is guaranteed to match
   * something Meta will actually accept on send — stops users getting
   * stuck on error #132001 "Template name does not exist".
   */
  async function handleSyncFromMeta() {
    if (!user) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Sync failed (HTTP ${res.status})`);
      }
      toast.success(
        `Synced ${data.total} template${data.total === 1 ? '' : 's'} from Meta` +
        (data.inserted || data.updated
          ? ` (${data.inserted} new, ${data.updated} updated)`
          : ''),
      );
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        // Surface per-template failures so users don't trust a green
        // toast that hides silent drift.
        const preview = data.errors.slice(0, 3).map(
          (e: { name: string; language: string; message: string }) =>
            `${e.name} (${e.language})`,
        );
        const suffix =
          data.errors.length > 3 ? `, +${data.errors.length - 3} more` : '';
        toast.error(`Failed to sync: ${preview.join(', ')}${suffix}`);
      }
      if (data.truncated) {
        toast.warning(
          'Hit Meta pagination cap — more templates may exist. Contact support if this persists.',
        );
      }
      await fetchTemplates();
    } catch (err) {
      console.error('Template sync error:', err);
      toast.error(
        err instanceof Error ? err.message : 'Failed to sync templates',
      );
    } finally {
      setSyncing(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/whatsapp/templates/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to delete template');
      }
      toast.success('Template deleted');
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete template');
    }
  }

  const formNeeds = sampleNeeds({
    header_type: form.header_type,
    header_content: form.header_content,
    body_text: form.body_text,
    buttons: form.buttons,
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-foreground">Message Templates</h2>
          <p className="text-xs sm:text-sm text-muted mt-0.5">
            Create a template here and submit it to Meta for review, or use &quot;Sync from
            Meta&quot; to pull templates made in WhatsApp Manager.
          </p>
        </div>
        <div className="ui-actions flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={handleSyncFromMeta}
            disabled={syncing}
            size="sm"
            className="border-border bg-transparent text-foreground hover:bg-surface-light text-xs sm:text-sm"
            title="Pull approved templates from your Meta WhatsApp Business Account"
          >
            <RefreshCw
              className={`size-3.5 sm:size-4 ${syncing ? 'animate-spin' : ''}`}
            />
            <span className="hidden xs:inline">{syncing ? 'Syncing…' : 'Sync from Meta'}</span>
            <span className="xs:hidden">{syncing ? '…' : 'Sync'}</span>
          </Button>
          <Button
            onClick={openNewTemplate}
            size="sm"
            className="bg-accent hover:bg-accent-hover text-white text-xs sm:text-sm"
          >
            <Plus className="size-3.5 sm:size-4" />
            <span className="hidden sm:inline">New Template</span>
            <span className="sm:hidden">New</span>
          </Button>
        </div>
      </div>

      {/* Template List */}
      {templates.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-10 sm:py-12 text-center px-4">
          <p className="text-muted text-sm">No templates yet.</p>
          <p className="text-muted text-xs mt-1">
            Create your first message template to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-2.5">
          {templates.map((template) => (
            <div key={template.id} className="glass-card px-3.5 sm:px-4 py-3 sm:py-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1.5 min-w-0 flex-1">
                  {/* Name + badges row */}
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                    <h3 className="font-medium text-foreground text-sm truncate max-w-[200px] sm:max-w-none">
                      {template.name}
                    </h3>
                    <Badge
                      className={`text-[10px] sm:text-xs border px-1.5 py-0 sm:px-2 sm:py-0.5 ${categoryColors[template.category] || ''}`}
                    >
                      {template.category}
                    </Badge>
                    <Badge
                      className={`text-[10px] sm:text-xs border px-1.5 py-0 sm:px-2 sm:py-0.5 ${statusColors[template.status || 'Draft'] || ''}`}
                    >
                      {template.status || 'Draft'}
                    </Badge>
                    {template.language && (
                      <span className="text-[10px] sm:text-xs text-muted uppercase">{template.language}</span>
                    )}
                  </div>
                  {/* Body preview */}
                  <p className="text-xs sm:text-sm text-muted line-clamp-2">{template.body_text}</p>
                  {template.footer_text && (
                    <p className="text-[10px] sm:text-xs text-muted italic">{template.footer_text}</p>
                  )}
                  {template.status_reason && (
                    <p className="text-[10px] sm:text-xs text-red-400">{template.status_reason}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {(template.status || 'Draft') === 'Draft' &&
                    !template.meta_template_id &&
                    template.category !== 'Authentication' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSubmitTarget(template)}
                      className="border-border bg-transparent text-foreground hover:bg-surface-light text-xs h-7 sm:h-8"
                      title="Send this template to Meta for approval"
                    >
                      <Send className="size-3.5" />
                      <span className="hidden sm:inline">Submit to Meta</span>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(template.id)}
                    className="text-muted hover:text-red-500 hover:bg-red-50 shrink-0 size-7 sm:size-8"
                  >
                    <Trash2 className="size-3.5 sm:size-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Template Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !submitting && (open ? setDialogOpen(true) : closeNewTemplate())}>
        <DialogContent className="bg-surface border-border sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">New Message Template</DialogTitle>
            <DialogDescription className="text-muted">
              Save it as a draft, or save and send it to Meta for review in one step.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-3.5 py-2 min-w-0">
            <div className="space-y-1.5">
              <Label className="text-foreground text-xs sm:text-sm">Template Name</Label>
              <Input
                placeholder="e.g. order_confirmation"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: typedTemplateName(e.target.value) })}
              />
              <p className="text-[10px] sm:text-[11px] text-muted">
                Lowercase letters, numbers and underscores, as Meta requires.
              </p>
            </div>

            {/* Responsive: 2-col on sm+, 1-col on mobile */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <Label className="text-foreground text-xs sm:text-sm">Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(val) =>
                    setForm({ ...form, category: val as MessageTemplate['category'] })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-foreground text-xs sm:text-sm">Language</Label>
                <Input
                  list="template-language-codes"
                  placeholder="en_US"
                  value={form.language}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                />
                <datalist id="template-language-codes">
                  {COMMON_LANGUAGE_CODES.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
                <p className="text-[10px] sm:text-[11px] text-muted">
                  Must match the exact language code on Meta — e.g. <code>en_US</code> and <code>en</code>{' '}
                  are distinct.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-foreground text-xs sm:text-sm">Header Type</Label>
              <Select
                value={form.header_type}
                items={HEADER_TYPE_ITEMS}
                onValueChange={(val) => {
                  setForm({ ...form, header_type: val || '' });
                  // A sample picked for another header type no longer fits.
                  setSamples({ ...samples, file: null });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    None
                  </SelectItem>
                  {HEADER_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.header_type === 'location' && (
                <p className="text-[10px] sm:text-[11px] text-muted">
                  A map pin at the top of the message. You choose the place each time you send. Marketing and Utility
                  only.
                </p>
              )}
            </div>

            {form.header_type === 'text' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-foreground text-xs sm:text-sm">Header Text</Label>
                  <TemplateTextToolbar
                    fieldRef={headerTextRef}
                    value={form.header_content}
                    onChange={(header_content) => setForm({ ...form, header_content })}
                    formatting={false}
                    maxVariables={1}
                  />
                </div>
                <Input
                  ref={headerTextRef}
                  placeholder="Up to 60 characters. One variable, {{1}}, allowed."
                  maxLength={TEMPLATE_LIMITS.headerText}
                  value={form.header_content}
                  onChange={(e) => setForm({ ...form, header_content: e.target.value })}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-foreground text-xs sm:text-sm">Body Text</Label>
                <TemplateTextToolbar
                  fieldRef={bodyRef}
                  value={form.body_text}
                  onChange={(body_text) => setForm({ ...form, body_text })}
                />
              </div>
              <Textarea
                ref={bodyRef}
                placeholder="Enter your template message body. Use {{1}}, {{2}} for variables."
                value={form.body_text}
                onChange={(e) => setForm({ ...form, body_text: e.target.value })}
                rows={5}
                maxLength={TEMPLATE_LIMITS.body}
                className="resize-y"
              />
              <p className="text-right text-[10px] text-muted">
                {form.body_text.length}/{TEMPLATE_LIMITS.body}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-foreground text-xs sm:text-sm">Footer Text</Label>
              <Input
                placeholder="Optional footer text"
                value={form.footer_text}
                onChange={(e) => setForm({ ...form, footer_text: e.target.value })}
                maxLength={TEMPLATE_LIMITS.footer}
              />
            </div>

            <TemplateButtonEditor buttons={form.buttons} onChange={(buttons) => setForm({ ...form, buttons })} />

            {hasSampleNeeds(formNeeds) && (
              <div className="space-y-3 rounded-md border border-border p-3">
                <div>
                  <p className="text-foreground text-xs sm:text-sm font-medium">Samples for Meta&apos;s review</p>
                  <p className="text-[10px] sm:text-[11px] text-muted">
                    Needed for &quot;Save &amp; Submit to Meta&quot;. Meta checks the template with these; customers never
                    see them.
                  </p>
                </div>
                <TemplateSampleFields
                  needs={formNeeds}
                  buttons={form.buttons}
                  samples={samples}
                  onChange={setSamples}
                  disabled={submitting}
                />
              </div>
            )}

            {formError && (
              <p role="alert" className="rounded-md border border-red-600/30 bg-red-600/10 px-3 py-2 text-xs text-red-400">
                {formError}
              </p>
            )}
          </div>

          <div className="py-2 lg:sticky lg:top-0 lg:self-start">
            <TemplatePreview
              headerType={form.header_type}
              headerText={form.header_content}
              body={form.body_text}
              footer={form.footer_text}
              buttons={form.buttons}
              headerExample={samples.headerExample}
              bodyExamples={samples.bodyExamples}
              sampleFile={samples.file}
            />
          </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={closeNewTemplate}
              disabled={submitting}
              className="border-border text-foreground hover:bg-surface-light"
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={handleSave}
              disabled={saving || submitting}
              className="border-border text-foreground hover:bg-surface-light"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save as Draft'
              )}
            </Button>
            <Button
              onClick={handleSaveAndSubmit}
              disabled={saving || submitting || form.category === 'Authentication'}
              title={
                form.category === 'Authentication'
                  ? 'Authentication templates must be created in WhatsApp Manager'
                  : 'Save this template and send it to Meta for approval'
              }
              className="bg-accent hover:bg-accent-hover text-white"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  Save &amp; Submit to Meta
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TemplateSubmitDialog
        template={submitTarget}
        onOpenChange={(open) => {
          if (!open) setSubmitTarget(null);
        }}
        onSubmitted={fetchTemplates}
      />
    </div>
  );
}
