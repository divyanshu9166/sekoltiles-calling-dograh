'use client';

import { useEffect, useState, useCallback, type DragEvent } from 'react';
import { Contact, CustomField, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Users,
  Tags,
  Filter,
  Upload,
  CheckSquare,
  Loader2,
  ArrowRight,
  ArrowLeft,
  X,
} from 'lucide-react';

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

interface Step2Props {
  audience: AudienceConfig;
  onUpdate: (audience: AudienceConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

const audienceOptions: {
  type: AudienceType;
  label: string;
  description: string;
  icon: typeof Users;
}[] = [
    {
      type: 'all',
      label: 'All Contacts',
      description: 'Send to every contact in your database',
      icon: Users,
    },
    {
      type: 'tags',
      label: 'Filter by Tags',
      description: 'Target contacts with specific tags',
      icon: Tags,
    },
    {
      type: 'custom_field',
      label: 'Custom Field',
      description: 'Filter by a custom field value',
      icon: Filter,
    },
    {
      type: 'manual',
      label: 'Select Contacts',
      description: 'Pick specific contacts from your list',
      icon: CheckSquare,
    },
    {
      type: 'csv',
      label: 'Upload CSV',
      description: 'Upload a list of phone numbers',
      icon: Upload,
    },
  ];

const OPERATOR_OPTIONS: { value: CustomFieldOperator; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'contains', label: 'contains' },
];

const CSV_PHONE_HEADERS = ['phone', 'mobile', 'number', 'whatsapp'];
const CSV_NAME_HEADERS = ['name', 'full name', 'customer'];
const MANUAL_PAGE_SIZE = 20;

function normalizePhone(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const cleaned = trimmed.replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) {
    return `+${cleaned.slice(1).replace(/\+/g, '')}`;
  }
  return cleaned.replace(/\+/g, '');
}

function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows
    .map((cells) => cells.map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell.length > 0));
}

function parseCsvContacts(text: string): {
  contacts: { phone: string; name?: string }[];
  error?: string;
} {
  const rows = parseCsvText(text);
  if (rows.length === 0) {
    return { contacts: [], error: 'CSV is empty.' };
  }

  const header = rows[0].map((cell) => cell.toLowerCase());
  const phoneIndex = header.findIndex((cell) =>
    CSV_PHONE_HEADERS.some((hint) => cell.includes(hint)),
  );
  const nameIndex = header.findIndex((cell) =>
    CSV_NAME_HEADERS.some((hint) => cell.includes(hint)),
  );

  const hasHeader = phoneIndex !== -1 || nameIndex !== -1;
  const startIndex = hasHeader ? 1 : 0;
  const resolvedPhoneIndex = phoneIndex !== -1 ? phoneIndex : 0;
  const resolvedNameIndex =
    nameIndex !== -1 ? nameIndex : resolvedPhoneIndex === 0 ? 1 : 0;

  const unique = new Map<string, { phone: string; name?: string }>();
  for (const row of rows.slice(startIndex)) {
    const phone = normalizePhone(row[resolvedPhoneIndex] ?? '');
    if (!phone) continue;
    const name = (row[resolvedNameIndex] ?? '').trim() || undefined;
    if (!unique.has(phone)) {
      unique.set(phone, { phone, name });
    }
  }

  const contacts = [...unique.values()];
  if (contacts.length === 0) {
    return { contacts, error: 'No valid phone numbers found.' };
  }

  return { contacts };
}

export function Step2SelectAudience({
  audience,
  onUpdate,
  onNext,
  onBack,
}: Step2Props) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [manualContacts, setManualContacts] = useState<Contact[]>([]);
  const [manualSearch, setManualSearch] = useState('');
  const [manualPage, setManualPage] = useState(0);
  const [manualTotal, setManualTotal] = useState(0);
  const [manualLoading, setManualLoading] = useState(false);

  useEffect(() => {
    async function fetchTags() {
      setLoadingTags(true);
      try {
        const res = await fetch('/api/whatsapp/tags');
        if (res.ok) {
          const { data } = await res.json();
          setTags(data ?? []);
        }
      } finally {
        setLoadingTags(false);
      }
    }
    fetchTags();
  }, []);

  useEffect(() => {
    if (audience.type !== 'custom_field') return;
    async function fetchFields() {
      setLoadingFields(true);
      try {
        const res = await fetch('/api/whatsapp/custom-fields');
        if (res.ok) {
          const { data } = await res.json();
          setCustomFields(data ?? []);
        }
      } finally {
        setLoadingFields(false);
      }
    }
    fetchFields();
  }, [audience.type]);

  const fetchManualContacts = useCallback(async () => {
    if (audience.type !== 'manual') return;
    setManualLoading(true);
    try {
      const params = new URLSearchParams({
        page: manualPage.toString(),
        pageSize: MANUAL_PAGE_SIZE.toString(),
      });
      if (manualSearch.trim()) {
        params.append('search', manualSearch.trim());
      }
      const res = await fetch(`/api/whatsapp/contacts?${params.toString()}`);
      if (res.ok) {
        const { data, total } = await res.json();
        setManualContacts(data ?? []);
        setManualTotal(total ?? 0);
      }
    } catch {
      setManualContacts([]);
      setManualTotal(0);
    } finally {
      setManualLoading(false);
    }
  }, [audience.type, manualPage, manualSearch]);

  useEffect(() => {
    fetchManualContacts();
  }, [fetchManualContacts]);

  const fetchEstimatedCount = useCallback(async () => {
    setLoadingCount(true);
    try {
      if (audience.type === 'csv' && audience.csvContacts && audience.csvContacts.length > 0) {
        setEstimatedCount(audience.csvContacts.length);
        return;
      }
      
      const res = await fetch('/api/whatsapp/broadcasts/audience-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience })
      });
      
      if (res.ok) {
        const { count } = await res.json();
        setEstimatedCount(count);
      } else {
        setEstimatedCount(null);
      }
    } catch {
      setEstimatedCount(null);
    } finally {
      setLoadingCount(false);
    }
  }, [
    audience,
  ]);

  useEffect(() => {
    fetchEstimatedCount();
  }, [fetchEstimatedCount]);

  function toggleTag(tagId: string) {
    const current = audience.tagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, tagIds: updated });
  }

  function toggleExcludeTag(tagId: string) {
    const current = audience.excludeTagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, excludeTagIds: updated });
  }

  function updateCustomField(patch: Partial<CustomFieldFilter>) {
    const prev = audience.customField ?? {
      fieldId: '',
      operator: 'is' as CustomFieldOperator,
      value: '',
    };
    onUpdate({ ...audience, customField: { ...prev, ...patch } });
  }

  function toggleManualContact(contactId: string) {
    const current = audience.selectedContactIds ?? [];
    const updated = current.includes(contactId)
      ? current.filter((id) => id !== contactId)
      : [...current, contactId];
    onUpdate({ ...audience, selectedContactIds: updated });
  }

  function clearManualSelection() {
    onUpdate({ ...audience, selectedContactIds: [] });
  }

  function toggleManualPageSelection() {
    const pageIds = manualContacts.map((c) => c.id);
    if (pageIds.length === 0) return;
    const current = new Set(audience.selectedContactIds ?? []);
    const allSelected = pageIds.every((id) => current.has(id));
    let updated: string[];
    if (allSelected) {
      updated = (audience.selectedContactIds ?? []).filter(
        (id) => !pageIds.includes(id),
      );
    } else {
      updated = [...new Set([...(audience.selectedContactIds ?? []), ...pageIds])];
    }
    onUpdate({ ...audience, selectedContactIds: updated });
  }

  function clearCsv() {
    setCsvFileName(null);
    setCsvError(null);
    onUpdate({ ...audience, csvContacts: [] });
  }

  function handleCsvFile(file: File) {
    setCsvError(null);

    const isCsv =
      file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';
    if (!isCsv) {
      setCsvError('Please upload a CSV file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const { contacts, error } = parseCsvContacts(text);
      if (error) {
        setCsvError(error);
        onUpdate({ ...audience, type: 'csv', csvContacts: [] });
        return;
      }
      setCsvFileName(file.name);
      setCsvError(null);
      onUpdate({ ...audience, type: 'csv', csvContacts: contacts });
    };
    reader.onerror = () => {
      setCsvError('Failed to read the CSV file.');
    };
    reader.readAsText(file);
  }

  function handleCsvDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) handleCsvFile(file);
  }

  function handleCsvDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleCsvDragLeave() {
    setIsDragging(false);
  }

  const csvContactsCount = audience.csvContacts?.length ?? 0;
  const selectedContactIds = audience.selectedContactIds ?? [];
  const selectedContactSet = new Set(selectedContactIds);
  const manualTotalPages = Math.max(1, Math.ceil(manualTotal / MANUAL_PAGE_SIZE));
  const manualFrom = manualTotal === 0 ? 0 : manualPage * MANUAL_PAGE_SIZE + 1;
  const manualTo = Math.min((manualPage + 1) * MANUAL_PAGE_SIZE, manualTotal);
  const manualHasPrev = manualPage > 0;
  const manualHasNext = manualPage + 1 < manualTotalPages;
  const manualPageSelected =
    manualContacts.length > 0 &&
    manualContacts.every((contact) => selectedContactSet.has(contact.id));

  const isValid =
    audience.type === 'all' ||
    (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) ||
    (audience.type === 'custom_field' &&
      !!audience.customField?.fieldId &&
      audience.customField.value.length > 0) ||
    (audience.type === 'manual' && selectedContactIds.length > 0) ||
    (audience.type === 'csv' && csvContactsCount > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Select Audience</h2>
        <p className="mt-1 text-sm text-muted">
          Choose who will receive this broadcast.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {audienceOptions.map((option) => {
          const isSelected = audience.type === option.type;
          const Icon = option.icon;
          return (
            <button
              key={option.type}
              type="button"
              aria-pressed={isSelected}
              onClick={() =>
                onUpdate({
                  ...audience,
                  // Wipe shape fields from other types to avoid stale
                  // config leaking across selections.
                  type: option.type,
                  tagIds: option.type === 'tags' ? audience.tagIds : undefined,
                  customField:
                    option.type === 'custom_field'
                      ? audience.customField
                      : undefined,
                  csvContacts:
                    option.type === 'csv' ? audience.csvContacts : undefined,
                  selectedContactIds:
                    option.type === 'manual'
                      ? audience.selectedContactIds
                      : undefined,
                })
              }
              className={`group relative flex items-start gap-3 rounded-2xl border p-4 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${isSelected
                  ? 'border-accent/50 bg-accent-light shadow-[0_0_0_1px_rgba(180,83,9,0.15)]'
                  : 'border-border bg-surface hover:border-border-light hover:shadow-card-hover'
                }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isSelected
                    ? 'bg-accent-light text-accent'
                    : 'bg-surface-light text-muted'
                  }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{option.label}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {option.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {audience.type === 'tags' && (
        <div className="glass-card p-4">
          <p className="mb-3 text-sm font-medium text-foreground">Select Tags</p>
          {loadingTags ? (
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
          ) : tags.length === 0 ? (
            <p className="text-xs text-muted">
              No tags found. Create tags in Settings.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const isSelected = audience.tagIds?.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${isSelected
                        ? 'border-accent/40 bg-accent-light text-accent'
                        : 'border-border bg-surface-light text-foreground hover:border-border-light'
                      }`}
                  >
                    <span
                      className="mr-1.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {audience.type === 'custom_field' && (
        <div className="glass-card space-y-3 p-4">
          <p className="text-sm font-medium text-foreground">Custom Field Filter</p>
          {loadingFields ? (
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
          ) : customFields.length === 0 ? (
            <p className="text-xs text-muted">
              No custom fields defined. Create one in Settings → Custom Fields.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]">
              <select
                value={audience.customField?.fieldId ?? ''}
                onChange={(e) => updateCustomField({ fieldId: e.target.value })}
              >
                <option value="">Select field...</option>
                {customFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.field_name}
                  </option>
                ))}
              </select>
              <select
                value={audience.customField?.operator ?? 'is'}
                onChange={(e) =>
                  updateCustomField({
                    operator: e.target.value as CustomFieldOperator,
                  })
                }
              >
                {OPERATOR_OPTIONS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={audience.customField?.value ?? ''}
                onChange={(e) => updateCustomField({ value: e.target.value })}
                placeholder="Value"
              />
            </div>
          )}
        </div>
      )}

      {audience.type === 'manual' && (
        <div className="glass-card space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-foreground">Select Contacts</p>
              <p className="mt-1 text-xs text-muted">
                Choose specific contacts to receive this broadcast.
              </p>
            </div>
            {selectedContactIds.length > 0 && (
              <button
                type="button"
                onClick={clearManualSelection}
                className="text-xs font-medium text-accent hover:text-accent-hover"
              >
                Clear selection
              </button>
            )}
          </div>

          <Input
            value={manualSearch}
            onChange={(e) => {
              setManualSearch(e.target.value);
              setManualPage(0);
            }}
            placeholder="Search by name, phone, or email..."
          />

          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              {manualTotal > 0
                ? `Showing ${manualFrom}-${manualTo} of ${manualTotal}`
                : 'No contacts found.'}
            </span>
            <button
              type="button"
              onClick={toggleManualPageSelection}
              className="text-xs font-medium text-accent hover:text-accent-hover"
            >
              {manualPageSelected ? 'Clear page' : 'Select page'}
            </button>
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            <ScrollArea className="h-56">
              {manualLoading ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-accent" />
                </div>
              ) : manualContacts.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-xs text-muted">
                  No contacts available.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {manualContacts.map((contact) => (
                    <label
                      key={contact.id}
                      className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-surface-hover transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedContactSet.has(contact.id)}
                        onChange={() => toggleManualContact(contact.id)}
                        className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">
                          {contact.name || 'Unnamed'}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {contact.phone}
                          {contact.email ? ` • ${contact.email}` : ''}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setManualPage((p) => Math.max(0, p - 1))}
              disabled={!manualHasPrev}
              className="border-border text-muted"
            >
              Previous
            </Button>
            <span className="text-xs text-muted">
              Page {manualPage + 1} of {manualTotalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setManualPage((p) => (manualHasNext ? p + 1 : p))}
              disabled={!manualHasNext}
              className="border-border text-muted"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {audience.type === 'csv' && (
        <div className="glass-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Upload CSV</p>
            {csvContactsCount > 0 && (
              <button
                type="button"
                onClick={clearCsv}
                className="text-xs font-medium text-accent hover:text-accent-hover"
              >
                Clear list
              </button>
            )}
          </div>
          <label
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all ${isDragging
                ? 'border-accent bg-accent-light'
                : 'border-border hover:border-border-light hover:bg-surface-hover'
              }`}
            onDragOver={handleCsvDragOver}
            onDragLeave={handleCsvDragLeave}
            onDrop={handleCsvDrop}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleCsvFile(file);
                event.target.value = '';
              }}
            />
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-accent-light text-accent">
              <Upload className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-foreground">
              Drop a CSV file here or click to upload
            </p>
            <p className="mt-1 text-xs text-muted">
              Columns: phone, name (optional)
            </p>
          </label>
          {csvError && <p className="mt-2 text-xs text-danger">{csvError}</p>}
          {csvContactsCount > 0 && (
            <div className="mt-3 rounded-lg border border-border bg-surface-light px-3 py-2 text-xs text-muted">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">
                  {csvFileName ?? 'CSV list loaded'}
                </span>
                <span>{csvContactsCount.toLocaleString()} contacts</span>
              </div>
              <div className="mt-2 grid gap-1 text-[11px] text-muted">
                {audience.csvContacts?.slice(0, 3).map((contact, index) => (
                  <div
                    key={`${contact.phone}-${index}`}
                    className="flex items-center justify-between"
                  >
                    <span className="truncate">{contact.phone}</span>
                    <span className="truncate opacity-60">
                      {contact.name ?? 'Unnamed'}
                    </span>
                  </div>
                ))}
                {csvContactsCount > 3 && (
                  <div className="opacity-60">
                    and {csvContactsCount - 3} more...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Exclude list - applies regardless of audience type */}
      <div className="glass-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <X className="h-4 w-4 text-danger" />
          <p className="text-sm font-medium text-foreground">
            Exclude contacts with these tags
          </p>
          <span className="text-xs text-muted">(optional)</span>
        </div>
        {tags.length === 0 ? (
          <p className="text-xs text-muted">No tags available.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const isExcluded = audience.excludeTagIds?.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleExcludeTag(tag.id)}
                  className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${isExcluded
                      ? 'border-danger/30 bg-danger-light text-danger'
                      : 'border-border bg-surface-light text-foreground hover:border-border-light'
                    }`}
                >
                  <span
                    className="mr-1.5 h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Audience Summary */}
      <div className="glass-card p-4">
        <p className="mb-2 text-sm font-medium text-foreground">Audience Summary</p>
        {loadingCount ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            <span className="text-xs text-muted">Calculating...</span>
          </div>
        ) : estimatedCount !== null ? (
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold text-foreground">
              {estimatedCount.toLocaleString()}
            </span>
            <span className="text-xs text-muted">estimated recipients</span>
          </div>
        ) : (
          <p className="text-xs text-muted">
            Select an audience type to see the estimate.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-border text-muted"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid}
          className="bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Next
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
