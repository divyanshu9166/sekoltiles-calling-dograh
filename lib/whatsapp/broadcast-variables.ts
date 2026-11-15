// Fills a broadcast template's {{n}} variables for one contact. Shared by the
// server-side broadcast sender and the wizard.

export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string }

export interface VariableContact {
  name?: string | null
  phone?: string | null
  email?: string | null
  company?: string | null
}

/** Reads the `template_variables` JSON stored on a broadcast. */
export function parseVariableMappings(value: unknown): Record<string, VariableMapping> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, VariableMapping> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const { type, value: v } = raw as Record<string, unknown>
    if ((type === 'static' || type === 'field' || type === 'custom_field') && typeof v === 'string') {
      out[key] = { type, value: v }
    }
  }
  return out
}

/** Values in {{1}}, {{2}}, ... order for this contact. */
export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: VariableContact,
  customValues?: Record<string, string>,
): string[] {
  return variableKeys(variables).map((key) => {
    const v = variables[key]
    if (v.type === 'static') return v.value

    if (v.type === 'field') {
      const fieldMap: Record<string, string | null | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      }
      return fieldMap[v.value] ?? ''
    }

    return customValues?.[v.value] ?? ''
  })
}

/** The {{n}} keys in sending order, as resolveVariables returns their values. */
export function variableKeys(variables: Record<string, VariableMapping>): string[] {
  return Object.keys(variables).sort((a, b) => {
    const an = Number(a)
    const bn = Number(b)
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
    return a.localeCompare(b)
  })
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Contact Name',
  phone: 'Phone Number',
  email: 'Email Address',
  company: 'Company',
}

/** "Contact field: Email Address", "Custom field: City", "Static value". */
export function describeMapping(mapping: VariableMapping, customFieldName?: string): string {
  if (mapping.type === 'static') return 'Static value'
  if (mapping.type === 'field') return `Contact field: ${FIELD_LABELS[mapping.value] ?? mapping.value}`
  return `Custom field: ${customFieldName ?? 'a custom field'}`
}

/**
 * Variables that would go to Meta empty for this contact. WhatsApp rejects
 * an empty template variable with error #131008, so these must not be sent.
 */
export function blankVariables(variables: Record<string, VariableMapping>, params: string[]): string[] {
  return variableKeys(variables).filter((_, i) => !String(params[i] ?? '').trim())
}

/** Why a contact was not sent the broadcast, naming the empty variables. */
export function blankVariablesReason(variables: Record<string, VariableMapping>, keys: string[]): string {
  const list = keys.map((k) => `{{${k}}} (${describeMapping(variables[k])})`).join(', ')
  return `Not sent: ${list} is empty for this contact. WhatsApp rejects empty template values; fill it in or map it to another field.`
}
