'use client';

import { useEffect, useMemo, useState } from 'react';
import { Contact, CustomField, MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, ArrowRight, Eye, Loader2 } from 'lucide-react';

type VariableType = 'static' | 'field' | 'custom_field';

interface VariableMapping {
  type: VariableType;
  value: string;
}

interface Step3Props {
  template: MessageTemplate;
  variables: Record<string, VariableMapping>;
  onUpdate: (variables: Record<string, VariableMapping>) => void;
  onNext: () => void;
  onBack: () => void;
}

const contactFields = [
  { value: 'name', label: 'Contact Name' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'email', label: 'Email Address' },
  { value: 'company', label: 'Company' },
];

const SAMPLE_CONTACT: Contact = {
  id: 'sample',
  user_id: '',
  name: 'John Doe',
  phone: '+1234567890',
  email: 'john@example.com',
  company: 'Acme Corp',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export function Step3Personalize({ template, variables, onUpdate, onNext, onBack }: Step3Props) {
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingFields, setLoadingFields] = useState(true);
  const [firstContact, setFirstContact] = useState<Contact | null>(null);
  const [firstContactCustomValues, setFirstContactCustomValues] = useState<Map<string, string>>(new Map());
  const [loadingPreview, setLoadingPreview] = useState(true);

  // Load custom fields + a representative contact for the live preview via API routes
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Fetch custom fields and first contact in parallel
        const [fieldsRes, contactsRes] = await Promise.all([
          fetch('/api/whatsapp/custom-fields', { cache: 'no-store' }),
          fetch('/api/whatsapp/contacts?page=0&page_size=1', { cache: 'no-store' }),
        ]);

        if (cancelled) return;

        if (fieldsRes.ok) {
          const body = await fieldsRes.json();
          setCustomFields(body.data ?? []);
        }
        setLoadingFields(false);

        if (contactsRes.ok) {
          const body = await contactsRes.json();
          const contact: Contact | null = (body.data ?? [])[0] ?? null;
          setFirstContact(contact);

          // Fetch custom values for this contact
          if (contact) {
            const valRes = await fetch(`/api/whatsapp/contacts/${contact.id}/custom-values`, { cache: 'no-store' });
            if (!cancelled && valRes.ok) {
              const valBody = await valRes.json();
              const map = new Map<string, string>();
              for (const row of valBody.data ?? []) {
                map.set(row.custom_field_id, row.value ?? '');
              }
              setFirstContactCustomValues(map);
            }
          }
        }
      } catch {
        // Non-fatal: live preview falls back to sample data
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const placeholders = useMemo(() => {
    const matches = template.body_text.match(/\{\{(\d+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches)].sort();
  }, [template.body_text]);

  const unmappedKeys = useMemo(() => {
    const missing: string[] = [];
    for (const placeholder of placeholders) {
      const key = placeholder.replace(/^\{\{|\}\}$/g, '');
      const mapping = variables[key];
      if (!mapping || !mapping.value?.trim()) missing.push(placeholder);
    }
    return missing;
  }, [placeholders, variables]);

  function updateVariable(key: string, patch: Partial<VariableMapping>) {
    const current = variables[key] ?? { type: 'static' as VariableType, value: '' };
    onUpdate({ ...variables, [key]: { ...current, ...patch } });
  }

  const previewText = useMemo(() => {
    const contact = firstContact ?? SAMPLE_CONTACT;
    const customValues = firstContact ? firstContactCustomValues : new Map<string, string>();

    let text = template.body_text;
    for (const placeholder of placeholders) {
      const key = placeholder.replace(/^\{\{|\}\}$/g, '');
      const mapping = variables[key];
      let replacement = placeholder;

      if (mapping) {
        if (mapping.type === 'static' && mapping.value) {
          replacement = mapping.value;
        } else if (mapping.type === 'field' && mapping.value) {
          const fieldMap: Record<string, string | undefined> = {
            name: contact.name,
            phone: contact.phone,
            email: contact.email,
            company: contact.company,
          };
          replacement = fieldMap[mapping.value] ?? placeholder;
        } else if (mapping.type === 'custom_field' && mapping.value) {
          replacement = customValues.get(mapping.value) || placeholder;
        }
      }
      text = text.replaceAll(placeholder, replacement);
    }
    return text;
  }, [template.body_text, variables, placeholders, firstContact, firstContactCustomValues]);

  const previewLabel = firstContact ? firstContact.name || firstContact.phone : 'sample data';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Personalize Message</h2>
        <p className="mt-1 text-sm text-muted">
          Map template variables to contact fields, custom fields, or static values.
        </p>
      </div>

      {placeholders.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-6 text-center">
          <p className="text-sm text-muted">This template has no variables to personalize.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {placeholders.map((placeholder) => {
            const key = placeholder.replace(/^\{\{|\}\}$/g, '');
            const mapping = variables[key] ?? { type: 'static', value: '' };
            return (
              <div key={placeholder} className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-flex items-center rounded-md bg-accent px-2 py-0.5 text-xs font-mono font-medium text-accent">
                    {placeholder}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted">Mapping Type</label>
                    <Select value={mapping.type ?? 'static'} onValueChange={(val) => updateVariable(key, { type: val as VariableType, value: '' })}>
                      <SelectTrigger className="w-full border-border bg-surface-light text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-border bg-surface-light">
                        <SelectItem value="static">Static Value</SelectItem>
                        <SelectItem value="field">Contact Field</SelectItem>
                        <SelectItem value="custom_field">Custom Field</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted">
                      {mapping.type === 'static' ? 'Value' : 'Field'}
                    </label>
                    {mapping.type === 'static' ? (
                      <Input
                        value={mapping.value}
                        onChange={(e) => updateVariable(key, { value: e.target.value })}
                        placeholder="Enter value..."
                        className="border-border bg-surface-light text-foreground placeholder:text-muted"
                      />
                    ) : mapping.type === 'field' ? (
                      <Select value={mapping.value ?? ''} onValueChange={(val) => updateVariable(key, { value: val ?? '' })}>
                        <SelectTrigger className="w-full border-border bg-surface-light text-foreground">
                          <SelectValue placeholder="Select field..." />
                        </SelectTrigger>
                        <SelectContent className="border-border bg-surface-light">
                          {contactFields.map((field) => <SelectItem key={field.value} value={field.value}>{field.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Select value={mapping.value ?? ''} onValueChange={(val) => updateVariable(key, { value: val ?? '' })}>
                        <SelectTrigger className="w-full border-border bg-surface-light text-foreground">
                          <SelectValue placeholder={loadingFields ? 'Loading…' : customFields.length === 0 ? 'No custom fields' : 'Select custom field…'} />
                        </SelectTrigger>
                        <SelectContent className="border-border bg-surface-light">
                          {customFields.map((f) => <SelectItem key={f.id} value={f.id}>{f.field_name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Live Preview */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2">
          <Eye className="h-4 w-4 text-accent" />
          <p className="text-sm font-medium text-foreground">Live Preview</p>
          <span className="text-xs text-muted">({previewLabel})</span>
          {loadingPreview && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
        </div>
        <div className="rounded-lg bg-[#0e1a12] p-3">
          <div className="ml-auto max-w-[85%] rounded-lg bg-accent px-3 py-2 shadow-sm">
            <p className="whitespace-pre-wrap text-sm text-accent">{previewText}</p>
          </div>
        </div>
      </div>

      {unmappedKeys.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Map every placeholder before continuing — still missing{' '}
          <span className="font-mono font-semibold">{unmappedKeys.join(', ')}</span>
          . Otherwise those placeholders will ship to Meta as empty strings.
        </div>
      )}

      <div className="ui-actions flex items-center justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack} className="border-border text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button onClick={onNext} disabled={unmappedKeys.length > 0} className="bg-accent text-foreground hover:bg-accent disabled:opacity-50">
          Next
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
