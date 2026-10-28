// The samples Meta needs to review a template (a value for every {{n}} and a
// file for a photo/video/PDF header), shared by the New Template form's
// "Save & Submit to Meta" and the Submit to Meta dialog. Pure so both can run
// the server's checks before anything is sent.

import { checkTemplateHeaderMedia } from '@/lib/whatsapp/outbound-media'
import { isMediaHeaderType, type TemplateHeaderMediaType } from '@/lib/whatsapp/template-header'
import {
  buildTemplateCreatePayload,
  toMetaCategory,
  toMetaTemplateName,
  variableCount,
  TemplateValidationError,
  type BuildTemplateCreatePayloadArgs,
  type TemplateButtonInput,
  type TemplateHeaderInput,
} from '@/lib/whatsapp/template-submission'

export interface TemplateSamples {
  headerExample: string
  bodyExamples: string[]
  /** By button position; only URL buttons ending in {{1}} use one. */
  buttonExamples: string[]
  file: File | null
}

export const EMPTY_SAMPLES: TemplateSamples = {
  headerExample: '',
  bodyExamples: [],
  buttonExamples: [],
  file: null,
}

/** The template fields the samples depend on, from a saved row or the form. */
export interface TemplateDraft {
  name: string
  category: string
  language?: string | null
  header_type?: string | null
  header_content?: string | null
  body_text: string
  footer_text?: string | null
  buttons: TemplateButtonInput[]
}

export interface SampleNeeds {
  mediaHeader: TemplateHeaderMediaType | null
  headerVars: number
  bodyVars: number
  /** Indexes of URL buttons whose link ends in {{1}}. */
  urlButtonIndexes: number[]
}

export function sampleNeeds(draft: Pick<TemplateDraft, 'header_type' | 'header_content' | 'body_text' | 'buttons'>): SampleNeeds {
  const mediaHeader = isMediaHeaderType(draft.header_type) ? draft.header_type : null
  return {
    mediaHeader,
    headerVars: draft.header_type === 'text' ? variableCount(draft.header_content) : 0,
    bodyVars: variableCount(draft.body_text),
    urlButtonIndexes: draft.buttons.flatMap((b, i) => (b.type === 'URL' && variableCount(b.url) > 0 ? [i] : [])),
  }
}

export function hasSampleNeeds(needs: SampleNeeds) {
  return !!needs.mediaHeader || needs.headerVars > 0 || needs.bodyVars > 0 || needs.urlButtonIndexes.length > 0
}

function submitArgs(draft: TemplateDraft, samples: TemplateSamples, handle: string): BuildTemplateCreatePayloadArgs {
  const category = toMetaCategory(draft.category)
  if (!category) {
    throw new TemplateValidationError(
      'Authentication templates need Meta’s one-time-password setup. Create them in WhatsApp Manager, then sync.',
    )
  }
  const mediaHeader = isMediaHeaderType(draft.header_type) ? draft.header_type : null
  let header: TemplateHeaderInput | null = null
  if (draft.header_type === 'text') {
    header = { format: 'TEXT', text: draft.header_content ?? '', example: samples.headerExample }
  } else if (mediaHeader) {
    header = { format: mediaHeader.toUpperCase() as 'IMAGE' | 'VIDEO' | 'DOCUMENT', handle }
  } else if (draft.header_type === 'location') {
    header = { format: 'LOCATION' }
  }
  return {
    name: toMetaTemplateName(draft.name),
    language: draft.language || 'en_US',
    category,
    header,
    body: draft.body_text,
    bodyExamples: samples.bodyExamples,
    footer: draft.footer_text,
    buttons: draft.buttons.map((b, i) => (b.type === 'URL' ? { ...b, example: samples.buttonExamples[i] ?? '' } : b)),
  }
}

/**
 * Runs the checks the submit route runs, so most mistakes show without a
 * round trip to Meta. Throws TemplateValidationError with a readable message.
 */
export function checkTemplateSubmission(draft: TemplateDraft, samples: TemplateSamples) {
  const mediaHeader = isMediaHeaderType(draft.header_type) ? draft.header_type : null
  if (mediaHeader) {
    if (!samples.file) throw new TemplateValidationError('Attach a sample file for the header so Meta can review it.')
    const check = checkTemplateHeaderMedia(mediaHeader, samples.file)
    if (!check.ok) throw new TemplateValidationError(check.error)
  }
  buildTemplateCreatePayload(submitArgs(draft, samples, 'pending-upload'))
}

/** Body for POST /api/whatsapp/templates/{id}/submit. */
export function templateSubmitFormData(draft: TemplateDraft, samples: TemplateSamples) {
  const form = new FormData()
  form.append('header_example', samples.headerExample)
  form.append('body_examples', JSON.stringify(samples.bodyExamples))
  form.append('button_examples', JSON.stringify(samples.buttonExamples))
  if (isMediaHeaderType(draft.header_type) && samples.file) form.append('file', samples.file)
  return form
}
