import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SEKOL_DOGRAH_PROMPT } from '../lib/calling-agent/prompt.mjs'

test('outbound and bulk leads pass their selected region into the Dograh call context', async () => {
  const [dograh, worker] = await Promise.all([
    readFile(new URL('../lib/dograh.ts', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/campaign-worker.mjs', import.meta.url), 'utf8'),
  ])

  assert.match(dograh, /region:\s*input\.region/)
  assert.match(worker, /region:\s*lead\.region \|\| ''/)
  assert.match(worker, /source:\s*'sekol-bulk-campaign'/)
  assert.match(SEKOL_DOGRAH_PROMPT, /12x18 only as “बारह-अठारह”/)
  assert.match(SEKOL_DOGRAH_PROMPT, /12x24 only as “बारह-चौबीस”/)
  assert.match(SEKOL_DOGRAH_PROMPT, /selected CRM lead zone/)
  assert.match(SEKOL_DOGRAH_PROMPT, /कैटलॉग शेयर कर सकती हूँ, या आप हमारे शोरूम में विज़िट करना चाहेंगे/)
})
