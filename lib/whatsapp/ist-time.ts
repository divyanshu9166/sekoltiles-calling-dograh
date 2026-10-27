// Broadcast scheduling is entered and shown in India time (IST, UTC+5:30,
// no daylight saving), whatever the browser's or server's own timezone is.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000

/** "2026-10-28" + "18:30" in IST → the matching instant, or null if malformed. */
export function istInputToDate(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return null
  const [y, mo, day] = [Number(d[1]), Number(d[2]), Number(d[3])]
  const [h, mi] = [Number(t[1]), Number(t[2])]
  if (mo < 1 || mo > 12 || day < 1 || day > 31 || h > 23 || mi > 59) return null
  const utc = Date.UTC(y, mo - 1, day, h, mi)
  // Reject dates like Feb 31 that Date.UTC silently rolls over.
  if (new Date(utc).getUTCDate() !== day) return null
  return new Date(utc - IST_OFFSET_MS)
}

/** The IST date and time inputs for an instant: { date: "YYYY-MM-DD", time: "HH:mm" }. */
export function dateToIstInput(instant: Date): { date: string; time: string } {
  const ist = new Date(instant.getTime() + IST_OFFSET_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`,
    time: `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`,
  }
}

/** "28 Oct 2026, 6:30 pm IST" */
export function formatIst(instant: Date | string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant
  return (
    d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' IST'
  )
}
