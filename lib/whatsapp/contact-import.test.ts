import { describe, it, expect } from 'vitest'
import { contactRows, parseContactCsv, readContactSheet } from './contact-import'

describe('company contact import', () => {
  it('reads BOM, commas, escaped quotes, multiline companies and numeric Excel phones', () => {
    expect(contactRows(parseContactCsv('\uFEFFcompany,phone\r\n"Tiles, ""India""",9876543210'))).toEqual([
      { company: 'Tiles, "India"', phone: '919876543210' },
    ])
    expect(contactRows([['Company Name', 'Phone'], ['Sekol Tiles', 919876543210]])[0]).toEqual({ company: 'Sekol Tiles', phone: '919876543210' })
    expect(contactRows(parseContactCsv('company,phone\n"Tiles\nIndia",919876543210'))[0].company).toBe('Tiles\nIndia')
  })
  it('rejects missing columns, missing companies, invalid phones and malformed CSV', () => {
    for (const rows of [[['name', 'phone']], [['company', 'phone'], ['', '9876543210']], [['company', 'phone'], ['Tiles', 'abc']]]) {
      expect(() => contactRows(rows)).toThrow()
    }
    expect(() => parseContactCsv('company,phone\n"oops')).toThrow()
    expect(contactRows([['company', 'phone'], ['', '']])).toEqual([])
  })
  it('reads big sheets leniently: skips bad rows and repeated phones and reports them', () => {
    const values: unknown[][] = [['Company', 'Mobile']]
    for (let i = 0; i < 12000; i++) values.push([`Dealer ${i}`, 9000000000 + i])
    values.push(['No phone', ''], ['', '9876543210'], ['Repeat', 9000000005], [])
    const sheet = readContactSheet(values)
    expect(sheet.rows).toHaveLength(12000)
    expect(sheet.rows[0]).toEqual({ company: 'Dealer 0', phone: '919000000000' })
    expect(sheet.invalidRows).toEqual([12002, 12003])
    expect(sheet.duplicates).toBe(1)
    expect(() => readContactSheet([['name', 'phone']])).toThrow(/company and phone/)
  })
})
