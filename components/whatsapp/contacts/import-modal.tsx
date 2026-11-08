'use client';

import { useState, useRef } from 'react';
import { toast } from 'sonner';
import {
  IMPORT_BATCH_SIZE,
  MAX_IMPORT_FILE_BYTES,
  parseContactCsv,
  readContactSheet,
  type ContactImportRow,
} from '@/lib/whatsapp/contact-import';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, FileText, Loader2, CheckCircle, XCircle } from 'lucide-react';

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

type ParsedRow = ContactImportRow;

export function ImportModal({ open, onOpenChange, onImported }: ImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [parsing, setParsing] = useState(false);
  const fileVersion = useRef(0);
  const [skipped, setSkipped] = useState<{ invalidRows: number[]; duplicates: number }>({ invalidRows: [], duplicates: 0 });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ imported: number; failed: number; existing: number } | null>(null);

  function reset() {
    fileVersion.current++;
    setParsing(false);
    setFile(null);
    setParsedRows([]);
    setSkipped({ invalidRows: [], duplicates: 0 });
    setProgress(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(open: boolean) {
    if (!open && importing) return; // let a running import finish
    if (!open) reset();
    onOpenChange(open);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    const version = ++fileVersion.current;
    setFile(selected);
    setResult(null);
    setParsedRows([]);
    setSkipped({ invalidRows: [], duplicates: 0 });
    setParsing(true);
    try {
      if (selected.size > MAX_IMPORT_FILE_BYTES) {
        throw new Error(`Choose a file smaller than ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB.`);
      }
      let values: unknown[][];
      if (/\.xlsx$/i.test(selected.name)) {
        const { readSheet } = await import('read-excel-file/browser');
        values = await readSheet(selected);
      } else if (/\.csv$/i.test(selected.name)) {
        values = parseContactCsv(await selected.text());
      } else throw new Error('Upload an Excel (.xlsx) or CSV (.csv) file.');
      const sheet = readContactSheet(values);
      if (!sheet.rows.length) {
        throw new Error(
          sheet.invalidRows.length
            ? `No valid contacts found. Check company and phone (with country code) in rows ${sheet.invalidRows.slice(0, 5).join(', ')}.`
            : 'No contacts found. Fill in company and phone below the headers.',
        );
      }
      if (version === fileVersion.current) {
        setParsedRows(sheet.rows);
        setSkipped({ invalidRows: sheet.invalidRows, duplicates: sheet.duplicates });
      }
    } catch (error) {
      if (version === fileVersion.current) toast.error(error instanceof Error ? error.message : 'Could not read this file.');
    } finally {
      if (version === fileVersion.current) setParsing(false);
    }
  }

  async function handleImport() {
    if (parsedRows.length === 0) return;
    setImporting(true);

    // Big sheets go up in batches so no single request is huge or slow.
    const totals = { imported: 0, failed: 0, existing: 0 };
    let stoppedAt: string | null = null;
    setProgress({ done: 0, total: parsedRows.length });
    for (let start = 0; start < parsedRows.length; start += IMPORT_BATCH_SIZE) {
      const batch = parsedRows.slice(start, start + IMPORT_BATCH_SIZE);
      try {
        const res = await fetch('/api/whatsapp/contacts/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: batch }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Import failed (HTTP ${res.status})`);
        totals.imported += Number(data?.imported ?? 0);
        totals.failed += Number(data?.failed ?? 0);
        totals.existing += Number(data?.existing ?? 0);
      } catch (err: unknown) {
        stoppedAt = err instanceof Error ? err.message : 'Import failed';
        totals.failed += parsedRows.length - start;
        break;
      }
      setProgress({ done: Math.min(start + batch.length, parsedRows.length), total: parsedRows.length });
    }

    setResult(totals);
    setProgress(null);
    setImporting(false);
    if (totals.imported > 0) {
      toast.success(`${totals.imported.toLocaleString()} contact${totals.imported !== 1 ? 's' : ''} imported`);
      onImported();
    }
    if (stoppedAt) toast.error(`Import stopped: ${stoppedAt}`);
    else if (totals.failed > 0) toast.error(`${totals.failed.toLocaleString()} contact${totals.failed !== 1 ? 's' : ''} failed to import`);
  }

  const preview = parsedRows.slice(0, 5);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-surface border-border text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground">Import Contacts</DialogTitle>
          <DialogDescription className="text-muted">
            Upload Excel (.xlsx) or CSV with two columns: company and phone. Include country code in the phone number.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <a href="/templates/whatsapp-contacts.xlsx" download className="text-sm text-accent underline">Download Excel template</a>
          {/* Upload area */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 cursor-pointer hover:border-accent transition-colors"
          >
            {file ? (
              <>
                <FileText className="size-8 text-accent" />
                <p className="text-sm text-foreground">{file.name}</p>
                <p className="text-xs text-muted">
                  {parsedRows.length} row{parsedRows.length !== 1 ? 's' : ''} detected
                </p>
              </>
            ) : (
              <>
                <Upload className="size-8 text-muted" />
                <p className="text-sm text-muted">
                  Click to upload Excel or CSV
                </p>
                <p className="text-xs text-muted">
                  Required columns: company, phone
                </p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Preview table */}
          {preview.length > 0 && !result && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted uppercase tracking-wider">
                Preview (first {preview.length} rows)
              </p>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-light">
                      <th className="px-3 py-1.5 text-left text-muted font-medium">Phone</th>
                                            <th className="px-3 py-1.5 text-left text-muted font-medium">Company</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-1.5 text-foreground">{row.phone}</td>
                                                <td className="px-3 py-1.5 text-foreground">{row.company || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsedRows.length > 5 && (
                <p className="text-xs text-muted">
                  ...and {(parsedRows.length - 5).toLocaleString()} more rows
                </p>
              )}
              {(skipped.invalidRows.length > 0 || skipped.duplicates > 0) && (
                <p className="text-xs text-amber-500">
                  {skipped.invalidRows.length > 0 &&
                    `${skipped.invalidRows.length.toLocaleString()} row${skipped.invalidRows.length !== 1 ? 's' : ''} skipped (no company or invalid phone): row ${skipped.invalidRows.slice(0, 8).join(', ')}${skipped.invalidRows.length > 8 ? '…' : ''}. `}
                  {skipped.duplicates > 0 &&
                    `${skipped.duplicates.toLocaleString()} repeated phone number${skipped.duplicates !== 1 ? 's' : ''} skipped.`}
                </p>
              )}
            </div>
          )}

          {progress && (
            <div className="space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-surface-light">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted">
                Importing {progress.done.toLocaleString()} of {progress.total.toLocaleString()}… keep this window open.
              </p>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="rounded-lg border border-border p-4 space-y-2">
              <p className="text-sm font-medium text-foreground">Import Complete</p>
              <div className="flex items-center gap-4">
                {result.imported > 0 && (
                  <div className="flex items-center gap-1.5 text-accent text-sm">
                    <CheckCircle className="size-4" />
                    {result.imported.toLocaleString()} imported
                  </div>
                )}
                {result.existing > 0 && (
                  <div className="flex items-center gap-1.5 text-muted text-sm">
                    <CheckCircle className="size-4" />
                    {result.existing.toLocaleString()} already in contacts
                  </div>
                )}
                {result.failed > 0 && (
                  <div className="flex items-center gap-1.5 text-red-400 text-sm">
                    <XCircle className="size-4" />
                    {result.failed.toLocaleString()} failed
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="bg-surface border-border">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={importing}
            className="border-border text-foreground hover:bg-surface-light"
          >
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button
              type="button"
              disabled={parsedRows.length === 0 || importing || parsing}
              onClick={handleImport}
              className="bg-accent hover:bg-accent text-foreground"
            >
              {(importing || parsing) && <Loader2 className="size-4 animate-spin" />}
              Import {parsedRows.length > 0 ? `${parsedRows.length.toLocaleString()} Contacts` : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
