/**
 * lib/ai-agent/chunker.ts
 *
 * Splits raw text into overlapping chunks suitable for embedding.
 * Target: ~512 tokens (≈ 2048 chars) with 64-token (256-char) overlap.
 * Strategy: paragraph-first, then sentence-level fallback for long paragraphs.
 */

const TARGET_CHARS = 512 * 4   // ~512 tokens
const OVERLAP_CHARS = 64 * 4   // ~64 tokens overlap
const MIN_CHUNK_LEN = 40       // discard tiny leftover chunks

export function chunkText(text: string): string[] {
  const clean = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (clean.length <= TARGET_CHARS) return [clean]

  const paragraphs = clean.split(/\n\n+/)
  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length <= TARGET_CHARS) {
      current += (current ? '\n\n' : '') + para
    } else {
      // Flush current chunk
      if (current) {
        chunks.push(current.trim())
        // Carry over tail for overlap
        current = current.slice(-OVERLAP_CHARS) + '\n\n' + para
      } else {
        // Paragraph itself is too long — split by sentence
        const sentences = para.match(/[^.!?\n]+[.!?\n]+/g) ?? [para]
        for (const s of sentences) {
          if ((current + s).length <= TARGET_CHARS) {
            current += s
          } else {
            if (current) chunks.push(current.trim())
            current = s
          }
        }
      }
    }
  }

  if (current.trim()) chunks.push(current.trim())

  return chunks.filter((c) => c.length >= MIN_CHUNK_LEN)
}
