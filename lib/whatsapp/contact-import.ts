export type ContactImportRow = { company: string; phone: string }

export function parseContactCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (c === ',' && !quoted) { row.push(cell); cell = '' }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.')
  row.push(cell); rows.push(row)
  return rows
}

/** Largest sheet the import dialog reads (it is parsed in the browser). */
export const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024
/** Rows sent per request; a big sheet goes up in several batches. */
export const IMPORT_BATCH_SIZE = 1000

type Columns = { company: number; phone: number }

function findColumns(values: unknown[][]): Columns {
  const header = (values[0] || []).map(v => String(v ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
  const company = header.findIndex(h => ['company', 'companyname'].includes(h))
  const phone = header.findIndex(h => ['phone', 'phonenumber', 'mobile', 'mobilenumber'].includes(h))
  if (company < 0 || phone < 0) throw new Error('Use company and phone column headers.')
  return { company, phone }
}

function readRow(row: unknown[], cols: Columns): ContactImportRow | null {
  const name = String(row[cols.company] ?? '').trim()
  let number = String(row[cols.phone] ?? '').trim().replace(/[\s()+-]/g, '')
  if (/^[6-9]\d{9}$/.test(number)) number = '91' + number
  if (!name || !/^[1-9]\d{7,14}$/.test(number)) return null
  return { company: name, phone: number }
}

const isBlank = (row: unknown[]) => !row.some(v => String(v ?? '').trim())

/** Strict: any bad row rejects the whole list. Used by the import API. */
export function contactRows(values: unknown[][]): ContactImportRow[] {
  const cols = findColumns(values)
  return values.slice(1).filter(row => !isBlank(row)).map((row, i) => {
    const contact = readRow(row, cols)
    if (!contact) throw new Error(`Row ${i + 2}: enter a company name and valid phone number with country code.`)
    return contact
  })
}

export interface ContactSheet {
  rows: ContactImportRow[]
  /** Sheet row numbers (header is row 1) without a company or a valid phone. */
  invalidRows: number[]
  /** Repeats of a phone already earlier in the sheet. */
  duplicates: number
}

/**
 * Lenient read for big sheets: bad rows and repeated phones are skipped and
 * reported instead of stopping the whole import.
 */
export function readContactSheet(values: unknown[][]): ContactSheet {
  const cols = findColumns(values)
  const seen = new Set<string>()
  const sheet: ContactSheet = { rows: [], invalidRows: [], duplicates: 0 }
  values.forEach((row, i) => {
    if (i === 0 || isBlank(row)) return
    const contact = readRow(row, cols)
    if (!contact) sheet.invalidRows.push(i + 1)
    else if (seen.has(contact.phone)) sheet.duplicates++
    else {
      seen.add(contact.phone)
      sheet.rows.push(contact)
    }
  })
  return sheet
}
