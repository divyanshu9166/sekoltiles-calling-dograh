import test from 'node:test'
import assert from 'node:assert/strict'
import { transcriptMessages } from '../lib/transcripts/parse.mjs'

test('keeps unlabelled Dograh lines with the preceding speaker', () => {
  const messages = transcriptMessages([
    '[2026-09-25T06:12:21.507+00:00] user: Hello.',
    'अभी मैम मैं बाहर था, कल बात करना।',
    '[2026-09-25T06:12:28.564+00:00] assistant: जी, समझ गई।',
    'क्या हम आपको कल कॉल करें?',
  ].join('\n'))

  assert.equal(messages.length, 2)
  assert.deepEqual(messages.map(message => message.from), ['customer', 'agent'])
  assert.match(messages[0].text, /अभी मैम मैं बाहर था/)
  assert.match(messages[1].text, /क्या हम आपको कल कॉल करें/)
})

test('does not guess the speaker for a transcript with no label', () => {
  assert.equal(transcriptMessages('कल बात कर लेंगे।')[0].from, 'unknown')
})
