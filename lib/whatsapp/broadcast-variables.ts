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
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a)
    const bn = Number(b)
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
    return a.localeCompare(b)
  })

  return keys.map((key) => {
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
