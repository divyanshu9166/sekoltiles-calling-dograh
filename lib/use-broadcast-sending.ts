'use client';

import { useState } from 'react';
import { MessageTemplate } from '@/types';
import type { VariableMapping } from '@/lib/whatsapp/broadcast-variables';
import type { TemplateSendExtras } from '@/lib/whatsapp/template-send-extras';

export type { VariableMapping };

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv' | 'manual';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  selectedContactIds?: string[];
  excludeTagIds?: string[];
}

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  /** Uploaded photo/video/PDF for a template with a media header. */
  headerMedia?: { type: 'image' | 'video' | 'document'; id: string; filename?: string };
  /** Header {{1}}, location pin, link endings and offer code for every recipient. */
  extras?: TemplateSendExtras;
  /** Send later instead of now. */
  scheduledAt?: Date;
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
}

/**
 * Creates the broadcast and hands it to the server's sending queue. The
 * sending itself runs in the worker (lib/queues/broadcast-send-worker.ts),
 * so closing the tab doesn't stop it; the detail page shows live progress.
 */
export function useBroadcastSending(): UseBroadcastSendingReturn {
  const [isProcessing, setIsProcessing] = useState(false);

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    try {
      const res = await fetch('/api/whatsapp/broadcasts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name,
          template: payload.template,
          audience: payload.audience,
          variables: payload.variables,
          ...(payload.headerMedia ? { header_media: payload.headerMedia } : {}),
          ...(payload.extras ? { template_extras: payload.extras } : {}),
          ...(payload.scheduledAt ? { scheduled_at: payload.scheduledAt.toISOString() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create broadcast');
      }
      return data.broadcastId as string;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing };
}
