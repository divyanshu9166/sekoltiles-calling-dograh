'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TemplateSendExtras, TemplateSendNeeds } from '@/lib/whatsapp/template-send-extras';

interface TemplateSendExtrasFieldsProps {
  needs: TemplateSendNeeds;
  extras: TemplateSendExtras;
  onChange: (extras: TemplateSendExtras) => void;
  disabled?: boolean;
}

/**
 * Asks for the template values that aren't body variables: header {{1}},
 * a location pin, website link endings and the offer code. The same values
 * go to every recipient of the send.
 */
export function TemplateSendExtrasFields({ needs, extras, onChange, disabled }: TemplateSendExtrasFieldsProps) {
  const location = extras.location;
  const setLocation = (patch: Partial<NonNullable<TemplateSendExtras['location']>>) =>
    onChange({ ...extras, location: { ...(location ?? {}), ...patch } });

  return (
    <div className="space-y-3">
      {needs.headerText && (
        <div className="space-y-1">
          <Label className="text-xs text-foreground">{'Header value for {{1}}'}</Label>
          <Input
            disabled={disabled}
            value={extras.headerText ?? ''}
            onChange={(e) => onChange({ ...extras, headerText: e.target.value })}
            placeholder="e.g. Diwali Sale"
          />
        </div>
      )}

      {needs.location && (
        <div className="space-y-1.5">
          <Label className="text-xs text-foreground">Location to show</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input
              disabled={disabled}
              inputMode="decimal"
              aria-label="Latitude"
              placeholder="Latitude, e.g. 22.8173"
              value={location?.latitude ?? ''}
              onChange={(e) => setLocation({ latitude: e.target.value })}
            />
            <Input
              disabled={disabled}
              inputMode="decimal"
              aria-label="Longitude"
              placeholder="Longitude, e.g. 70.8378"
              value={location?.longitude ?? ''}
              onChange={(e) => setLocation({ longitude: e.target.value })}
            />
          </div>
          <Input
            disabled={disabled}
            aria-label="Place name"
            placeholder="Place name (optional), e.g. Sekol Tiles showroom"
            value={location?.name ?? ''}
            onChange={(e) => setLocation({ name: e.target.value })}
          />
          <Input
            disabled={disabled}
            aria-label="Address"
            placeholder="Address (optional)"
            value={location?.address ?? ''}
            onChange={(e) => setLocation({ address: e.target.value })}
          />
          <p className="text-[10px] text-muted">
            In Google Maps, right-click the place and click the numbers at the top to copy latitude, longitude.
          </p>
        </div>
      )}

      {needs.urlButtons.map((button) => (
        <div key={button.index} className="space-y-1">
          <Label className="text-xs text-foreground">End of the link for “{button.text}”</Label>
          <Input
            disabled={disabled}
            value={extras.urlSuffixes?.[button.index] ?? ''}
            onChange={(e) =>
              onChange({ ...extras, urlSuffixes: { ...(extras.urlSuffixes ?? {}), [button.index]: e.target.value } })
            }
            placeholder="e.g. diwali-offer"
          />
          <p className="break-all text-[10px] text-muted">{button.url}</p>
        </div>
      ))}

      {needs.copyCodeIndex !== null && (
        <div className="space-y-1">
          <Label className="text-xs text-foreground">Offer code customers will copy</Label>
          <Input
            disabled={disabled}
            maxLength={20}
            value={extras.couponCode ?? ''}
            onChange={(e) => onChange({ ...extras, couponCode: e.target.value })}
            placeholder="e.g. DIWALI20"
          />
        </div>
      )}
    </div>
  );
}
