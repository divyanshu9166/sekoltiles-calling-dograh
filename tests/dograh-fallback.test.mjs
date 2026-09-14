import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Dograh Groq fallback reserves enough output for one valid tool call', async () => {
  const source = await readFile(new URL('../deploy/dograh/groq_model_fallback.py', import.meta.url), 'utf8')
  const override = await readFile(new URL('../deploy/dograh/docker-compose.override.yaml', import.meta.url), 'utf8')

  assert.match(source, /DEFAULT_FALLBACK_MAX_COMPLETION_TOKENS = 512/)
  assert.match(source, /"reasoning_effort": "low"/)
  assert.match(source, /"parallel_tool_calls": False/)
  assert.doesNotMatch(source, /"include_reasoning": False/)
  assert.match(override, /DOGRAH_GROQ_FALLBACK_MAX_COMPLETION_TOKENS:-512/)
  assert.match(override, /max_completion_tokens=192/)
})
