'use client';

import { useState } from 'react';
import { Contact, MessageTemplate } from '@/types';

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

export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  /** Uploaded photo/video/PDF for a template with a media header. */
  headerMedia?: { type: 'image' | 'video' | 'document'; id: string; filename?: string };
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BroadcastApiResult {
  phone: string;
  status: 'sent' | 'failed';
  whatsapp_message_id?: string;
  error?: string;
}

export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: any,
  customValues?: Record<string, string>,
): string[] {
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const v = variables[key];
    if (v.type === 'static') return v.value;

    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[v.value] ?? '';
    }

    return customValues?.[v.value] ?? '';
  });
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);

    try {
      setProgress(10);
      
      const createRes = await fetch('/api/whatsapp/broadcasts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!createRes.ok) {
        const errorData = await createRes.json();
        throw new Error(errorData.error || 'Failed to create broadcast');
      }
      
      const { broadcastId, recipients } = await createRes.json();
      
      if (!recipients || recipients.length === 0) {
        throw new Error('No valid recipients found');
      }

      setProgress(30);

      let failedCount = 0;
      const totalRecipients = recipients.length;

      for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
        const batch = recipients.slice(i, i + SEND_BATCH_SIZE);

        const apiRecipients = batch
          .filter((r: any) => r.phone)
          .map((r: any) => ({
            phone: r.phone as string,
            contact_id: r.contact_id,
            params: resolveVariables(
              payload.variables,
              r,
              r.custom_values,
            )
          }));

        if (apiRecipients.length === 0) continue;

        try {
          const res = await fetch('/api/whatsapp/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              broadcast_id: broadcastId,
              recipients: apiRecipients.map((r: any) => ({
                phone: r.phone,
                contact_id: r.contact_id,
                params: r.params,
              })),
              template_name: payload.template.name,
              template_language: payload.template.language ?? 'en_US',
              ...(payload.headerMedia ? { header_media: payload.headerMedia } : {}),
            }),
          });

          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || 'Broadcast API request failed');
          }

          const resultsByPhone = new Map<string, BroadcastApiResult>();
          for (const r of (data.results ?? []) as BroadcastApiResult[]) {
            resultsByPhone.set(r.phone, r);
          }

          const updates: any[] = [];

          for (const recipient of apiRecipients) {
            const phone = recipient.phone;
            const result = phone ? resultsByPhone.get(phone) : undefined;

            if (!result) {
              failedCount++;
              updates.push({
                contact_id: recipient.contact_id,
                status: 'failed',
                error_message: 'No phone number or failed to send'
              })
              continue;
            }

            if (result.status === 'sent') {
              updates.push({
                contact_id: recipient.contact_id,
                status: 'sent',
                whatsapp_message_id: result.whatsapp_message_id,
              })
            } else {
              failedCount++;
              updates.push({
                contact_id: recipient.contact_id,
                status: 'failed',
                error_message: result.error ?? 'Unknown error'
              })
            }
          }
          
          if (updates.length > 0) {
            await fetch('/api/whatsapp/broadcasts/recipients', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ broadcastId, updates })
            })
          }
        } catch (err) {
          const updates = batch.map((recipient: any) => {
            failedCount++;
            return {
              contact_id: recipient.contact_id,
              status: 'failed',
              error_message: err instanceof Error ? err.message : 'Unknown error'
            }
          })
          
          await fetch('/api/whatsapp/broadcasts/recipients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ broadcastId, updates })
          })
        }

        const progressPct = 30 + Math.round(((i + batch.length) / totalRecipients) * 60);
        setProgress(progressPct);

        if (i + SEND_BATCH_SIZE < recipients.length) {
          await sleep(SEND_BATCH_DELAY_MS);
        }
      }

      setProgress(95);
      const finalStatus = failedCount === totalRecipients ? 'failed' : 'sent';
      
      await fetch(`/api/whatsapp/broadcasts/${broadcastId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: finalStatus, failed_count: failedCount })
      })

      setProgress(100);
      return broadcastId;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress };
}
