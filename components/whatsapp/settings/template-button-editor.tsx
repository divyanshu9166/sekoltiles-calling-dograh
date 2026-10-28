'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ClipboardCopy,
  ExternalLink,
  MessageCircleReply,
  Phone,
  PhoneCall,
  Plus,
  UserRound,
  Workflow,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TEMPLATE_LIMITS, type TemplateButtonInput, type TemplateButtonType } from '@/lib/whatsapp/template-submission';

/** Button types in WhatsApp Manager's order and wording. */
export const BUTTON_OPTIONS: {
  type: TemplateButtonType;
  label: string;
  hint: string;
  defaultText: string;
  icon: typeof Plus;
}[] = [
  { type: 'QUICK_REPLY', label: 'Custom', hint: 'Quick reply the customer taps', defaultText: '', icon: MessageCircleReply },
  { type: 'URL', label: 'Visit website', hint: 'Opens a link', defaultText: 'Visit website', icon: ExternalLink },
  { type: 'VOICE_CALL', label: 'Call on WhatsApp', hint: 'WhatsApp call to your business number', defaultText: 'Call Now', icon: PhoneCall },
  { type: 'PHONE_NUMBER', label: 'Call phone number', hint: 'Normal phone call', defaultText: 'Call us', icon: Phone },
  { type: 'FLOW', label: 'Complete flow', hint: 'Opens a WhatsApp Flow form', defaultText: 'Book now', icon: Workflow },
  { type: 'COPY_CODE', label: 'Copy offer code', hint: 'Copies a coupon code', defaultText: '', icon: ClipboardCopy },
  { type: 'REQUEST_CONTACT_INFO', label: 'Share contact info', hint: 'Customer shares their contact card', defaultText: 'Share contact info', icon: UserRound },
];

const OPTION_BY_TYPE = Object.fromEntries(BUTTON_OPTIONS.map((o) => [o.type, o])) as Record<
  TemplateButtonType,
  (typeof BUTTON_OPTIONS)[number]
>;

/** Types that can appear once per template; offered only while unused. */
const SINGLE_USE: Partial<Record<TemplateButtonType, number>> = {
  URL: TEMPLATE_LIMITS.urlButtons,
  PHONE_NUMBER: TEMPLATE_LIMITS.phoneButtons,
  VOICE_CALL: 1,
  FLOW: 1,
  COPY_CODE: 1,
  REQUEST_CONTACT_INFO: 1,
};

interface TemplateButtonEditorProps {
  buttons: TemplateButtonInput[];
  onChange: (buttons: TemplateButtonInput[]) => void;
}

/** Add, edit and remove template buttons, like WhatsApp Manager's "Add button" menu. */
export function TemplateButtonEditor({ buttons, onChange }: TemplateButtonEditorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const used = (type: TemplateButtonType) => buttons.filter((b) => b.type === type).length;
  const available = (type: TemplateButtonType) => {
    const max = SINGLE_USE[type];
    return max === undefined || used(type) < max;
  };

  function add(type: TemplateButtonType) {
    setMenuOpen(false);
    const next: TemplateButtonInput = { type, text: OPTION_BY_TYPE[type].defaultText };
    // Meta wants quick replies kept together: put a new one next to the others.
    if (type === 'QUICK_REPLY') {
      const lastQuick = buttons.map((b) => b.type).lastIndexOf('QUICK_REPLY');
      if (lastQuick >= 0) {
        onChange([...buttons.slice(0, lastQuick + 1), next, ...buttons.slice(lastQuick + 1)]);
        return;
      }
    }
    onChange([...buttons, next]);
  }

  const update = (i: number, patch: Partial<TemplateButtonInput>) =>
    onChange(buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-foreground text-xs sm:text-sm font-medium">Buttons</span>
        <div className="relative" ref={menuRef}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={buttons.length >= TEMPLATE_LIMITS.buttons}
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="border-border bg-transparent text-foreground hover:bg-surface-light text-xs h-7"
          >
            <Plus className="size-3.5" />
            Add button
            <ChevronDown className="size-3.5" />
          </Button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-50 mt-1 w-64 rounded-md border border-border bg-surface p-1 shadow-lg"
            >
              {BUTTON_OPTIONS.map((option) => {
                const Icon = option.icon;
                const enabled = available(option.type);
                return (
                  <button
                    key={option.type}
                    type="button"
                    role="menuitem"
                    disabled={!enabled}
                    onClick={() => add(option.type)}
                    className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-light disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted" />
                    <span>
                      <span className="block text-sm text-foreground">{option.label}</span>
                      <span className="block text-[10px] text-muted">{enabled ? option.hint : 'Already added'}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {buttons.length === 0 && (
        <p className="text-[10px] sm:text-[11px] text-muted">
          Optional. Up to 10. Custom (quick reply) buttons are kept together. With more than 3 buttons WhatsApp shows 2
          and puts the rest under &quot;See all options&quot;.
        </p>
      )}

      {buttons.map((button, i) => {
        const option = OPTION_BY_TYPE[button.type];
        const Icon = option?.icon ?? Plus;
        return (
          <div key={i} className="rounded-md border border-border p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <Icon className="size-4 shrink-0 text-muted" />
              <span className="flex-1 text-xs font-medium text-foreground">{option?.label ?? button.type}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onChange(buttons.filter((_, j) => j !== i))}
                className="text-muted hover:text-red-500 shrink-0 size-7"
                title="Remove button"
                aria-label={`Remove ${option?.label ?? 'button'}`}
              >
                <X className="size-4" />
              </Button>
            </div>

            {button.type === 'COPY_CODE' ? (
              <>
                <Input
                  aria-label="Sample offer code"
                  placeholder="Sample offer code, e.g. DIWALI20"
                  maxLength={TEMPLATE_LIMITS.copyCode}
                  value={button.example ?? ''}
                  onChange={(e) => update(i, { example: e.target.value.toUpperCase().replace(/\s/g, '') })}
                />
                <p className="text-[10px] text-muted">
                  WhatsApp labels it &quot;Copy offer code&quot;. You enter the real code each time you send.
                </p>
              </>
            ) : (
              <Input
                aria-label="Button label"
                placeholder={`Button label (up to ${button.type === 'VOICE_CALL' ? TEMPLATE_LIMITS.voiceCallText : TEMPLATE_LIMITS.buttonText} characters)`}
                maxLength={button.type === 'VOICE_CALL' ? TEMPLATE_LIMITS.voiceCallText : TEMPLATE_LIMITS.buttonText}
                value={button.text}
                onChange={(e) => update(i, { text: e.target.value })}
              />
            )}

            {button.type === 'URL' && (
              <Input
                aria-label="Website link"
                placeholder="https://example.com/page (may end in {{1}})"
                value={button.url ?? ''}
                onChange={(e) => update(i, { url: e.target.value })}
              />
            )}
            {button.type === 'PHONE_NUMBER' && (
              <Input
                aria-label="Phone number"
                placeholder="Phone with country code, e.g. 919876543210"
                value={button.phone_number ?? ''}
                onChange={(e) => update(i, { phone_number: e.target.value })}
              />
            )}
            {button.type === 'VOICE_CALL' && (
              <p className="text-[10px] text-muted">
                Customers call your WhatsApp Business number inside WhatsApp. Calling must be turned on for the number
                in WhatsApp Manager.
              </p>
            )}
            {button.type === 'FLOW' && (
              <>
                <Input
                  aria-label="Flow ID"
                  inputMode="numeric"
                  placeholder="Flow ID, from WhatsApp Manager → Account tools → Flows"
                  value={button.flow_id ?? ''}
                  onChange={(e) => update(i, { flow_id: e.target.value.replace(/\D/g, '') })}
                />
                <Input
                  aria-label="First screen"
                  placeholder="First screen ID (optional)"
                  value={button.navigate_screen ?? ''}
                  onChange={(e) => update(i, { navigate_screen: e.target.value })}
                />
              </>
            )}
            {button.type === 'REQUEST_CONTACT_INFO' && (
              <p className="text-[10px] text-muted">
                The customer&apos;s contact card arrives in the inbox as a shared contact.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
