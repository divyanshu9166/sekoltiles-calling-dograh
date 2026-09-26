const CATALOGUE = /(?:catalogue|catalog|catlogue|कैटलॉग|कैटलोग)/iu
const DECLINE = /(?:nahi|nahin|no|not interested|मत|नहीं|नही)/iu
const REQUEST = /(?:chahiye|chahte|chahati|chahata|want(?:s|ed)?|share|send|bhej|भेज|शेयर|चाहिए|चाहते|चाहती|चाहता|कर दो|करदे|dijiye|दीजिए|please|haan|han|ha|yes|ज़रूर|जरूर|हाँ|हां)/iu
const DELIVERY = /(?:share|send|bhej|भेज|शेयर|भिजवा|भिजवा दो|forward)/iu
const APPOINTMENT = /(?:appointment|अपॉइंटमेंट|showroom|शोरूम|visit|विजिट|book|बुक|date|तारीख|time|समय)/iu
const CATALOGUE_ONLY = /^\s*(?:catalogue|catalog|catlogue|कैटलॉग|कैटलोग)[\s.!?।]*$/iu
const AFFIRMATIVE_ONLY = /^\s*(?:(?:haan|han|ha|yes|yeah|yep|हाँ|हां|जी|ji)[\s,.!?।]*){1,3}$/iu

function textOf(message) {
  return String(message?.text || '').trim()
}

function isCustomerCatalogueRequest(text) {
  return CATALOGUE.test(text) && REQUEST.test(text) && !DECLINE.test(text) && !APPOINTMENT.test(text)
}

function followsCatalogueDeliveryQuestion(messages, index, customerText) {
  // A short answer such as "हाँ जी भेज दो" is only unambiguous when the
  // immediately preceding agent turn offered catalogue delivery. Requiring a
  // delivery verb prevents a plain "yes" from being confused with appointment
  // booking when both options were offered in the same question.
  if (!DELIVERY.test(customerText) || DECLINE.test(customerText) || APPOINTMENT.test(customerText)) return false

  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const message = messages[previous]
    const text = textOf(message)
    if (!text) continue
    if (String(message?.from || '').toLowerCase() !== 'agent') return false
    return CATALOGUE.test(text) && DELIVERY.test(text)
  }

  return false
}

function answersCatalogueChoice(messages, index, customerText) {
  if (!CATALOGUE_ONLY.test(customerText) && !AFFIRMATIVE_ONLY.test(customerText)) return false

  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const message = messages[previous]
    const text = textOf(message)
    if (!text) continue
    return String(message?.from || '').toLowerCase() === 'agent'
      && CATALOGUE.test(text)
      && /(?:\?|？|चाह|share|send|शेयर|भेज)/iu.test(text)
  }

  return false
}

/**
 * Records an explicit catalogue request, including a delivery confirmation
 * immediately following the agent's catalogue question. A plain "yes" after a
 * catalogue offer counts as consent, even if an appointment was also offered.
 */
export function requestedCatalogue(messages) {
  if (!Array.isArray(messages)) return false
  return messages.some((message, index) => {
    if (!message || typeof message !== 'object') return false
    const from = String(message.from || '').toLowerCase()
    if (from !== 'customer') return false

    const text = textOf(message)
    return isCustomerCatalogueRequest(text)
      || followsCatalogueDeliveryQuestion(messages, index, text)
      || answersCatalogueChoice(messages, index, text)
  })
}
