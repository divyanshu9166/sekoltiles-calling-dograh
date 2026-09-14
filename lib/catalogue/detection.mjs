const CATALOGUE = /(?:catalogue|catalog|catlogue|कैटलॉग|कैटलोग)/iu
const DECLINE = /(?:nahi|nahin|no|not interested|मत|नहीं|नही)/iu
const REQUEST = /(?:chahiye|share|send|bhej|भेज|शेयर|चाहिए|कर दो|करदे|dijiye|दीजिए|please|haan|han|ha|yes|ज़रूर|जरूर|हाँ|हां)/iu

/** Only records an explicit customer request; an unqualified "yes" is ambiguous with appointment booking. */
export function requestedCatalogue(messages) {
  if (!Array.isArray(messages)) return false
  return messages.some((message) => {
    if (!message || typeof message !== 'object') return false
    const from = String(message.from || '').toLowerCase()
    const text = String(message.text || '').trim()
    return from === 'customer' && CATALOGUE.test(text) && !DECLINE.test(text) && REQUEST.test(text)
  })
}
