import { describe, expect, it } from 'vitest'
import { parseScheduledAt } from '@/lib/whatsapp/broadcast-schedule'
import { dateToIstInput, formatIst, istInputToDate } from '@/lib/whatsapp/ist-time'
import { parseVariableMappings, resolveVariables } from '@/lib/whatsapp/broadcast-variables'

describe('IST schedule inputs', () => {
  it('reads date and time as India time', () => {
    expect(istInputToDate('2026-10-28', '18:30')?.toISOString()).toBe('2026-10-28T13:00:00.000Z')
    expect(istInputToDate('2026-10-28', '02:00')?.toISOString()).toBe('2026-10-27T20:30:00.000Z')
  })

  it('rejects malformed or impossible dates', () => {
    expect(istInputToDate('2026-02-31', '10:00')).toBeNull()
    expect(istInputToDate('2026-10-28', '24:00')).toBeNull()
    expect(istInputToDate('', '10:00')).toBeNull()
  })

  it('round-trips through the inputs and formats in IST', () => {
    const instant = new Date('2026-10-27T20:30:00.000Z')
    expect(dateToIstInput(instant)).toEqual({ date: '2026-10-28', time: '02:00' })
    expect(formatIst(instant)).toMatch(/28 Oct 2026.*2:00\s*am IST/i)
  })
})

describe('parseScheduledAt', () => {
  const now = Date.parse('2026-10-27T10:00:00.000Z')

  it('treats a missing value as send now', () => {
    expect(parseScheduledAt(undefined, now)).toEqual({ scheduledAt: null })
    expect(parseScheduledAt('', now)).toEqual({ scheduledAt: null })
  })

  it('accepts a future time', () => {
    expect(parseScheduledAt('2026-10-27T12:00:00.000Z', now)).toEqual({ scheduledAt: new Date('2026-10-27T12:00:00.000Z') })
  })

  it('limits media-header broadcasts to 29 days, before Meta deletes the file', () => {
    const inDays = (d: number) => new Date(now + d * 24 * 60 * 60 * 1000).toISOString()
    expect(parseScheduledAt(inDays(40), now)).toHaveProperty('scheduledAt')
    expect(parseScheduledAt(inDays(40), now, { hasHeaderMedia: true })).toHaveProperty('error')
    expect(parseScheduledAt(inDays(20), now, { hasHeaderMedia: true })).toHaveProperty('scheduledAt')
  })

  it('rejects past, too-soon, too-far and invalid values', () => {
    expect(parseScheduledAt('2026-10-27T09:00:00.000Z', now)).toHaveProperty('error')
    expect(parseScheduledAt('2026-10-27T10:00:30.000Z', now)).toHaveProperty('error')
    expect(parseScheduledAt('2027-03-01T10:00:00.000Z', now)).toHaveProperty('error')
    expect(parseScheduledAt('soon', now)).toHaveProperty('error')
    expect(parseScheduledAt(12345, now)).toHaveProperty('error')
  })
})

describe('broadcast variables', () => {
  it('orders {{n}} numerically and fills fields, custom fields and static text', () => {
    const vars = parseVariableMappings({
      '10': { type: 'static', value: 'ten' },
      '2': { type: 'custom_field', value: 'f1' },
      '1': { type: 'field', value: 'name' },
      bad: { type: 'nope', value: 'x' },
    })
    expect(resolveVariables(vars, { name: 'Ravi' }, { f1: 'Nashik' })).toEqual(['Ravi', 'Nashik', 'ten'])
    expect(resolveVariables(vars, { name: null })).toEqual(['', '', 'ten'])
  })

  it('ignores a broken template_variables value', () => {
    expect(parseVariableMappings(null)).toEqual({})
    expect(parseVariableMappings(['x'])).toEqual({})
  })
})
