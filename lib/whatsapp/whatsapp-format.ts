// WhatsApp's text formatting (*bold*, _italic_, ~strikethrough~, ```monospace```)
// split into styled runs, so previews can render it without HTML strings.

export interface FormattedRun {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  mono?: boolean
}

type Style = 'bold' | 'italic' | 'strike'
const MARKERS: Record<string, Style> = { '*': 'bold', _: 'italic', '~': 'strike' }

/**
 * A marker only opens next to a word character and closes before a
 * non-word, as WhatsApp does: "2*3*4" stays plain, "*sale*" is bold.
 */
function findClose(text: string, marker: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\n') return -1
    if (text[i] === marker && i > from && text[i - 1] !== ' ') {
      const after = text[i + 1]
      if (after === undefined || !/[\p{L}\p{N}]/u.test(after)) return i
    }
  }
  return -1
}

function parseStyled(text: string, style: Omit<FormattedRun, 'text'>): FormattedRun[] {
  const runs: FormattedRun[] = []
  let plain = ''
  const flush = () => {
    if (plain) runs.push({ text: plain, ...style })
    plain = ''
  }
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('```', i)) {
      const close = text.indexOf('```', i + 3)
      if (close > i + 3) {
        flush()
        runs.push({ text: text.slice(i + 3, close), ...style, mono: true })
        i = close + 2
        continue
      }
    }
    const kind = MARKERS[text[i]]
    const before = text[i - 1]
    const opensWord = kind && (before === undefined || !/[\p{L}\p{N}]/u.test(before)) && text[i + 1] && text[i + 1] !== ' '
    if (opensWord) {
      const close = findClose(text, text[i], i + 1)
      if (close > i + 1) {
        flush()
        runs.push(...parseStyled(text.slice(i + 1, close), { ...style, [kind]: true }))
        i = close
        continue
      }
    }
    plain += text[i]
  }
  flush()
  return runs
}

export function formatWhatsAppText(text: string): FormattedRun[] {
  return parseStyled(text, {})
}

/** The number "Add variable" should insert next: one past the highest {{n}}. */
export function nextVariableNumber(text: string): number {
  let max = 0
  for (const match of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) max = Math.max(max, Number(match[1]))
  return max + 1
}

/** Replaces {{n}} with the sample for n when one is given. */
export function fillVariables(text: string, samples: string[]): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (token, n) => samples[Number(n) - 1]?.trim() || token)
}
