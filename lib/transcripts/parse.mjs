const SPEAKER_LINE = /^(?:\[([^\]]+)\]\s*)?(assistant|agent|bot|customer|user|caller):\s*(.*)$/i

export function transcriptMessages(value) {
  if (Array.isArray(value)) {
    const normalized = value.map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const role = String(item.from || item.role || item.speaker || '').toLowerCase()
      const text = String(item.text || item.content || '').trim()
      if (!text) return null
      return {
        from: /user|customer|caller|client/.test(role) ? 'customer'
          : /assistant|agent|bot/.test(role) ? 'agent' : 'unknown',
        text,
        time: typeof item.time === 'string' ? item.time : `0:${String(index * 4).padStart(2, '0')}`,
      }
    }).filter(Boolean)
    return normalized.length ? normalized : null
  }
  if (typeof value !== 'string' || !value.trim()) return null

  const messages = []
  let firstTimestamp = Number.NaN
  for (const line of value.split(/\r?\n/).map(text => text.trim()).filter(Boolean)) {
    const match = line.match(SPEAKER_LINE)
    if (!match) {
      // Dograh can continue a user or assistant turn on the next physical
      // line without repeating its speaker label or timestamp.
      if (messages.length) messages[messages.length - 1].text += ` ${line}`
      else messages.push({ from: 'unknown', text: line, time: '0:00' })
      continue
    }

    const timestamp = match[1] ? new Date(match[1]).getTime() : Number.NaN
    if (Number.isFinite(timestamp) && !Number.isFinite(firstTimestamp)) firstTimestamp = timestamp
    const elapsed = Number.isFinite(timestamp) && Number.isFinite(firstTimestamp)
      ? Math.max(0, Math.round((timestamp - firstTimestamp) / 1000))
      : messages.length * 4
    messages.push({
      from: /customer|user|caller/i.test(match[2]) ? 'customer' : 'agent',
      text: match[3].trim(),
      time: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`,
    })
  }
  const normalized = messages.filter(message => message.text)
  return normalized.length ? normalized : null
}
