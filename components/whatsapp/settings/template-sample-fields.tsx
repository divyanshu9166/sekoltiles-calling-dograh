'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatFileSize } from '@/lib/whatsapp/outbound-media';
import type { SampleNeeds, TemplateSamples } from '@/lib/whatsapp/template-samples';
import type { TemplateButtonInput } from '@/lib/whatsapp/template-submission';

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

interface TemplateSampleFieldsProps {
  needs: SampleNeeds;
  buttons: TemplateButtonInput[];
  samples: TemplateSamples;
  onChange: (samples: TemplateSamples) => void;
  disabled?: boolean;
}

/** Sample file and example values Meta asks for when reviewing a template. */
export function TemplateSampleFields({ needs, buttons, samples, onChange, disabled }: TemplateSampleFieldsProps) {
  const updateAt = (list: string[], index: number, value: string) => {
    const next = [...list];
    next[index] = value;
    return next;
  };

  return (
    <>
      {needs.mediaHeader && (
        <div className="space-y-1.5">
          <Label className="text-foreground text-xs sm:text-sm">{HEADER_FILE_LABEL[needs.mediaHeader]}</Label>
          {/* Keyed on the type so switching header type clears the picked file. */}
          <Input
            key={needs.mediaHeader}
            type="file"
            accept={HEADER_ACCEPT[needs.mediaHeader]}
            disabled={disabled}
            aria-label={HEADER_FILE_LABEL[needs.mediaHeader]}
            onChange={(e) => onChange({ ...samples, file: e.target.files?.[0] ?? null })}
          />
          <p className="text-[10px] sm:text-[11px] text-muted">
            {samples.file
              ? `${samples.file.name} · ${formatFileSize(samples.file.size)}`
              : 'Only used for Meta’s review. Each broadcast still attaches its own file.'}
          </p>
        </div>
      )}

      {needs.headerVars > 0 && (
        <div className="space-y-1.5">
          <Label className="text-foreground text-xs sm:text-sm">Header sample for {'{{1}}'}</Label>
          <Input
            disabled={disabled}
            value={samples.headerExample}
            onChange={(e) => onChange({ ...samples, headerExample: e.target.value })}
          />
        </div>
      )}

      {Array.from({ length: needs.bodyVars }, (_, i) => (
        <div key={`body-${i}`} className="space-y-1.5">
          <Label className="text-foreground text-xs sm:text-sm">Body sample for {`{{${i + 1}}}`}</Label>
          <Input
            disabled={disabled}
            value={samples.bodyExamples[i] ?? ''}
            onChange={(e) => onChange({ ...samples, bodyExamples: updateAt(samples.bodyExamples, i, e.target.value) })}
          />
        </div>
      ))}

      {needs.urlButtonIndexes.map((i) => (
        <div key={`button-${i}`} className="space-y-1.5">
          <Label className="text-foreground text-xs sm:text-sm">
            Sample for {'{{1}}'} in “{buttons[i]?.text || 'website button'}”
          </Label>
          <Input
            disabled={disabled}
            placeholder="e.g. summer-offer"
            value={samples.buttonExamples[i] ?? ''}
            onChange={(e) => onChange({ ...samples, buttonExamples: updateAt(samples.buttonExamples, i, e.target.value) })}
          />
          <p className="text-[10px] sm:text-[11px] text-muted break-all">{buttons[i]?.url}</p>
        </div>
      ))}
    </>
  );
}
