'use client';

import { useEffect, useState } from 'react';
import { FileText, ImageIcon, MapPin, Video } from 'lucide-react';
import { fillVariables, formatWhatsAppText, type FormattedRun } from '@/lib/whatsapp/whatsapp-format';
import type { TemplateButtonInput } from '@/lib/whatsapp/template-submission';
import { BUTTON_OPTIONS } from './template-button-editor';

interface TemplatePreviewProps {
  headerType: string;
  headerText: string;
  body: string;
  footer: string;
  buttons: TemplateButtonInput[];
  headerExample?: string;
  bodyExamples?: string[];
  /** Sample photo, shown in the header when it's an image. */
  sampleFile?: File | null;
}

function Runs({ runs }: { runs: FormattedRun[] }) {
  return (
    <>
      {runs.map((run, i) => (
        <span
          key={i}
          className={[
            run.bold ? 'font-semibold' : '',
            run.italic ? 'italic' : '',
            run.strike ? 'line-through' : '',
            run.mono ? 'font-mono text-[12px]' : '',
          ].join(' ')}
        >
          {run.text}
        </span>
      ))}
    </>
  );
}

const MEDIA_ICON = { image: ImageIcon, video: Video, document: FileText, location: MapPin } as const;

/** Roughly what the customer sees in WhatsApp, updated as the form changes. */
export function TemplatePreview({
  headerType,
  headerText,
  body,
  footer,
  buttons,
  headerExample = '',
  bodyExamples = [],
  sampleFile,
}: TemplatePreviewProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (headerType !== 'image' || !sampleFile?.type.startsWith('image/')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(sampleFile);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [headerType, sampleFile]);

  const MediaIcon = MEDIA_ICON[headerType as keyof typeof MEDIA_ICON];
  // WhatsApp shows 2 buttons and folds the rest under "See all options" when there are more than 3.
  const shown = buttons.length > 3 ? buttons.slice(0, 2) : buttons;
  const hasContent = body.trim() || headerText.trim() || footer.trim() || MediaIcon;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <p className="border-b border-border bg-surface px-3 py-2 text-xs font-medium text-foreground">Template preview</p>
      <div className="bg-[#e5ddd5] p-3 min-h-40">
        {!hasContent ? (
          <p className="text-center text-xs text-[#667781]">Start typing to see the message.</p>
        ) : (
          <div className="max-w-[92%] overflow-hidden rounded-lg bg-white text-[#111b21] shadow-sm">
            {MediaIcon && (
              <div className="m-1 flex h-28 items-center justify-center overflow-hidden rounded-md bg-[#cfd4d6]">
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrl} alt="Header sample" className="h-full w-full object-cover" />
                ) : (
                  <MediaIcon className="size-10 text-white" />
                )}
              </div>
            )}
            <div className="space-y-1 px-2.5 py-1.5">
              {headerType === 'text' && headerText.trim() && (
                <p className="text-sm font-semibold">{fillVariables(headerText, [headerExample])}</p>
              )}
              {body.trim() && (
                <p className="whitespace-pre-wrap break-words text-[13px] leading-snug">
                  <Runs runs={formatWhatsAppText(fillVariables(body, bodyExamples))} />
                </p>
              )}
              {footer.trim() && <p className="text-[11px] text-[#667781]">{footer}</p>}
              <p className="text-right text-[10px] text-[#667781]">12:00</p>
            </div>
            {shown.map((button, i) => {
              const option = BUTTON_OPTIONS.find((o) => o.type === button.type);
              const Icon = option?.icon;
              const label = button.type === 'COPY_CODE' ? 'Copy offer code' : button.text || option?.label || 'Button';
              return (
                <div
                  key={i}
                  className="flex items-center justify-center gap-1.5 border-t border-[#e9edef] px-2 py-2 text-[13px] text-[#027eb5]"
                >
                  {Icon && button.type !== 'QUICK_REPLY' && <Icon className="size-3.5" />}
                  {label}
                </div>
              );
            })}
            {buttons.length > 3 && (
              <div className="border-t border-[#e9edef] px-2 py-2 text-center text-[13px] text-[#027eb5]">
                See all options
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
