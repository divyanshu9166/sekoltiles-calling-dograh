import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Runs the WhatsApp Marketing unit tests ported from the Furniture CRM.
// inbox-state.test.ts uses node:test and runs under tsx instead (see the
// test:whatsapp script).
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    include: ['lib/whatsapp/**/*.test.ts', 'lib/wa-dashboard/**/*.test.ts'],
    exclude: ['lib/whatsapp/inbox-state.test.ts'],
    env: {
      // Throwaway test-only values; never real credentials.
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      META_APP_SECRET: 'test-meta-app-secret',
    },
  },
})
