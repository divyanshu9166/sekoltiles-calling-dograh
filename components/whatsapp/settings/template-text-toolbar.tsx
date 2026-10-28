'use client';

import type { RefObject } from 'react';
import { Bold, Code, Italic, Plus, Strikethrough } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { nextVariableNumber } from '@/lib/whatsapp/whatsapp-format';

interface TemplateTextToolbarProps {
  /** The input or textarea the toolbar edits. */
  fieldRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  /** Bold, italic, strikethrough and monospace; WhatsApp header text can't use them. */
  formatting?: boolean;
  /** Most variables the text may hold (the header allows one). */
  maxVariables?: number;
}

const FORMATS = [
  { marker: '*', label: 'Bold', icon: Bold },
  { marker: '_', label: 'Italic', icon: Italic },
  { marker: '~', label: 'Strikethrough', icon: Strikethrough },
  { marker: '```', label: 'Monospace', icon: Code },
] as const;

/**
 * Formatting and "Add variable" buttons like WhatsApp Manager's. Formatting
 * wraps the selected text in WhatsApp's markers (*bold*, _italic_, ~strike~,
 * ```code```); Add variable inserts the next {{n}} at the cursor.
 */
export function TemplateTextToolbar({ fieldRef, value, onChange, formatting = true, maxVariables }: TemplateTextToolbarProps) {
  const nextVar = nextVariableNumber(value);
  const canAddVariable = maxVariables === undefined || nextVar <= maxVariables;

  function replaceSelection(build: (selected: string) => { text: string; cursor: number }) {
    const field = fieldRef.current;
    const start = field?.selectionStart ?? value.length;
    const end = field?.selectionEnd ?? value.length;
    const { text, cursor } = build(value.slice(start, end));
    onChange(value.slice(0, start) + text + value.slice(end));
    // Put the cursor back after React re-renders the new value.
    requestAnimationFrame(() => {
      if (!field) return;
      field.focus();
      field.setSelectionRange(start + cursor, start + cursor);
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-0.5">
      {formatting &&
        FORMATS.map(({ marker, label, icon: Icon }) => (
          <Button
            key={label}
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted hover:text-foreground"
            title={label}
            aria-label={label}
            onClick={() =>
              replaceSelection((selected) => ({
                text: `${marker}${selected}${marker}`,
                // With nothing selected, land between the markers to type.
                cursor: selected ? marker.length * 2 + selected.length : marker.length,
              }))
            }
          >
            <Icon className="size-3.5" />
          </Button>
        ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-muted hover:text-foreground"
        disabled={!canAddVariable}
        title={canAddVariable ? `Insert {{${nextVar}}}` : 'The header can have only one variable'}
        onClick={() =>
          replaceSelection(() => {
            const token = `{{${nextVar}}}`;
            return { text: token, cursor: token.length };
          })
        }
      >
        <Plus className="size-3.5" />
        Add variable
      </Button>
    </div>
  );
}
