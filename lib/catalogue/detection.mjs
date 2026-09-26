const CATALOGUE = /(?:catalogue|catalog|catlogue|कैटलॉग|कैटलोग)/iu
const DECLINE = /(?:nahi|nahin|no|not interested|मत|नहीं|नही)/iu
const REQUEST = /(?:chahiye|chahte|chahati|chahata|want(?:s|ed)?|share|send|bhej|भेज|शेयर|चाहिए|चाहते|चाहती|चाहता|कर दो|करदे|dijiye|दीजिए|please|haan|han|ha|yes|ज़रूर|जरूर|हाँ|हां)/iu
const DELIVERY = /(?:share|send|bhej|भेज|शेयर|भिजवा|भिजवा दो|forward)/iu
const APPOINTMENT = /(?:appointment|अपॉइंटमेंट|showroom|शोरूम|visit|विजिट|book|बुक|date|तारीख|time|समय)/iu
const AFFIRMATIVE_START = /^(?:जी(?:\s+(?:सर|मैडम|हाँ|हां))?|हाँ|हां|yes|yeah|sure|okay|ok)(?=$|[\s.,।!?])/iu
const OTHER_QUESTION = /(?:price|rate|कीमत|कितना|कितनी|जीएसटी|gst|कहाँ|किस|कौन)/iu

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

function followsCombinedChoiceAffirmation(messages, index, customerText) {
  // Business default: a bare affirmative to “catalogue or appointment?”
  // means catalogue. An appointment still requires the customer's explicit intent.
  if (!AFFIRMATIVE_START.test(customerText) || DECLINE.test(customerText)
    || APPOINTMENT.test(customerText) || OTHER_QUESTION.test(customerText)) return false

  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const message = messages[previous]
    const text = textOf(message)
    if (!text) continue
    if (String(message?.from || '').toLowerCase() !== 'agent') return false
    return CATALOGUE.test(text) && DELIVERY.test(text) && APPOINTMENT.test(text)
  }

  return false
}

/**
 * Records an explicit catalogue request, including a delivery confirmation
 * immediately following the agent's catalogue question. For the combined
 * catalogue-or-appointment question, a bare yes defaults to catalogue only.
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
      || followsCombinedChoiceAffirmation(messages, index, text)
  })
}
