import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Dograh transfer requires deterministic explicit customer consent', async () => {
  const source = await readFile(new URL('../deploy/dograh/transfer_consent_guard.py', import.meta.url), 'utf8')
  const override = await readFile(new URL('../deploy/dograh/docker-compose.override.yaml', import.meta.url), 'utf8')

  assert.match(source, /explicit_consent_required/)
  assert.match(source, /customer_declined/)
  assert.match(source, /रहने\|रेहने\|रैने/)
  assert.match(source, /reinforce_transfer_decline_context/)
  assert.match(source, /latest_assistant/)
  assert.match(source, /_AFFIRMATIVE\.fullmatch/)
  assert.match(override, /transfer_consent_guard\.py/)
  assert.match(override, /install_transfer_consent_guard\(CustomToolManager\)/)
})
