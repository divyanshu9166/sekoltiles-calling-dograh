import 'server-only'

import { readSheet } from 'read-excel-file/node'
import { sanitizeCustomerName } from '@/lib/appointments/booking'

const MAX_IMPORT_BYTES = 5 * 1024 * 1024
const MAX_IMPORT_ROWS = 5000

export type ImportedCampaignLead = {
  name: string
  phone: string
  region: string | null
}

type ImportResult = {
  leads: ImportedCampaignLead[]
  rejectedRows: number
  duplicateRows: number
  missingRegionRows: number
}

const headerAliases = {
  name: new Set(['name', 'customername', 'clientname', 'partyname']),
  phone: new Set(['contactnumber', 'phonenumber', 'phone', 'contact', 'mobile', 'mobilenumber', 'number']),
  region: new Set(['regionzone', 'region', 'zone', 'state', 'area']),
}

function normalizedHeader(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizeImportPhone(value: unknown) {
  let phone = String(value ?? '').trim().replace(/\.0$/, '').replace(/[^\d+]/g, '')
  if (/^[6-9]\d{9}$/.test(phone)) phone = `+91${phone}`
  else if (/^91[6-9]\d{9}$/.test(phone)) phone = `+${phone}`
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null
}

function rowsToLeads(rows: unknown[][]): ImportResult {
  if (!rows.length) throw new Error('The sheet is empty.')
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new Error(`A campaign can contain at most ${MAX_IMPORT_ROWS} rows.`)

  const headers = rows[0].map(normalizedHeader)
  const findColumn = (aliases: Set<string>) => headers.findIndex(header => aliases.has(header))
  const nameColumn = findColumn(headerAliases.name)
  const phoneColumn = findColumn(headerAliases.phone)
  const regionColumn = findColumn(headerAliases.region)
  if (nameColumn < 0 || phoneColumn < 0 || regionColumn < 0) {
    throw new Error('Header row must contain Name, Contact Number, and Region/Zone columns.')
  }

  const leads: ImportedCampaignLead[] = []
  const seen = new Set<string>()
  let rejectedRows = 0
  let duplicateRows = 0
  let missingRegionRows = 0

  for (const row of rows.slice(1)) {
    if (!row.some(value => String(value ?? '').trim())) continue
    const rawName = String(row[nameColumn] ?? '').trim().slice(0, 120)
    const name = sanitizeCustomerName(rawName) || rawName
    const phone = normalizeImportPhone(row[phoneColumn])
    const regionText = String(row[regionColumn] ?? '').trim().slice(0, 120)
    if (!name || !phone) {
      rejectedRows += 1
      continue
    }
    if (seen.has(phone)) {
      duplicateRows += 1
      continue
    }
    seen.add(phone)
    if (!regionText) missingRegionRows += 1
    leads.push({ name, phone, region: regionText || null })
  }

  if (!leads.length) throw new Error('No valid customer rows were found.')
  return { leads, rejectedRows, duplicateRows, missingRegionRows }
}

function parseCsv(text: string): unknown[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') quoted = false
      else cell += character
    } else if (character === '"') quoted = true
    else if (character === ',') {
      row.push(cell)
      cell = ''
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''))
      rows.push(row)
      row = []
      cell = ''
    } else cell += character
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows
}

export async function importCampaignFile(file: File): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('The uploaded file must be 5 MB or smaller.')
  const lowerName = file.name.toLowerCase()
  const bytes = Buffer.from(await file.arrayBuffer())
  if (lowerName.endsWith('.xlsx')) return rowsToLeads(await readSheet(bytes) as unknown[][])
  if (lowerName.endsWith('.csv')) return rowsToLeads(parseCsv(bytes.toString('utf8').replace(/^\uFEFF/, '')))
  throw new Error('Upload an .xlsx or .csv file.')
}

export function googleSheetCsvUrl(sharedUrl: string) {
  let url: URL
  try { url = new URL(sharedUrl) } catch { throw new Error('Enter a valid Google Sheets URL.') }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') {
    throw new Error('Only docs.google.com spreadsheet links are supported.')
  }
  const match = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (!match) throw new Error('Enter a valid Google Sheets sharing link.')
  const gid = url.searchParams.get('gid') || url.hash.match(/gid=(\d+)/)?.[1] || '0'
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${encodeURIComponent(gid)}`
}

export async function importGoogleSheet(sharedUrl: string): Promise<ImportResult> {
  const response = await fetch(googleSheetCsvUrl(sharedUrl), {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('Google Sheet could not be downloaded. Set sharing to “Anyone with the link”.')
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > MAX_IMPORT_BYTES) throw new Error('The Google Sheet export must be 5 MB or smaller.')
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) throw new Error('The Google Sheet export must be 5 MB or smaller.')
  return rowsToLeads(parseCsv(text.replace(/^\uFEFF/, '')))
}
