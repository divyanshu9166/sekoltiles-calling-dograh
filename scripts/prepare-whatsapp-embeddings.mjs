// Installs what the WhatsApp AI agent's knowledge base needs on this server:
//   1. the local embedding model (same id/options as lib/ai-agent/embedder.ts),
//      downloaded once into TRANSFORMERS_CACHE_DIR and checked to give 384 dims;
//   2. pgvector + the wa_knowledge_chunks.embedding vector(384) column and index.
// Safe to re-run. Usage: node --env-file=.env scripts/prepare-whatsapp-embeddings.mjs
import pg from 'pg'

const MODEL = 'Xenova/multilingual-e5-small' // keep in sync with lib/ai-agent/embedder.ts
const DIMS = 384
let ok = true

// ── 1. Embedding model ──────────────────────────────────────────────────────
try {
  const { pipeline, env } = await import('@xenova/transformers')
  env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR || '/app/model-cache'
  console.log(`model: loading ${MODEL} into ${env.cacheDir} (first run downloads ~120 MB)…`)
  const embed = await pipeline('feature-extraction', MODEL, {
    quantized: true,
    progress_callback: (p) => {
      // Fired for cached files too, so this is not proof of a network download.
      if (p.status === 'download' && p.file) console.log(`  loading ${p.file}`)
    },
  })
  const out = await embed('query: tiles price kya hai?')
  const dims = out.dims.at(-1)
  if (dims !== DIMS) throw new Error(`model returned ${dims} dims, expected ${DIMS}`)
  console.log(`model: ready ✓ (${dims}-dim embeddings)`)
} catch (err) {
  ok = false
  console.error('model: FAILED —', err instanceof Error ? err.message : err)
}

// ── 2. pgvector column ──────────────────────────────────────────────────────
const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
try {
  await db.connect()
  const { rows: [{ server_version: version }] } = await db.query('SHOW server_version')
  try {
    await db.query('CREATE EXTENSION IF NOT EXISTS vector')
  } catch (err) {
    throw new Error(
      `pgvector is not installed on PostgreSQL ${version} (${err.message}).\n` +
      `  Postgres on the host:  sudo apt install postgresql-${version.split('.')[0]}-pgvector\n` +
      `  Postgres in Docker:    switch the image to pgvector/pgvector:pg${version.split('.')[0]} (same data volume)\n` +
      '  Then run this script again.',
    )
  }

  const { rows: [table] } = await db.query("SELECT to_regclass('public.wa_knowledge_chunks') AS t")
  if (!table.t) throw new Error('wa_knowledge_chunks is missing — run `npm run db:migrate` first')

  const { rows: [col] } = await db.query(
    "SELECT atttypmod AS dims FROM pg_attribute WHERE attrelid = 'wa_knowledge_chunks'::regclass AND attname = 'embedding' AND NOT attisdropped",
  )
  if (!col) {
    await db.query(`ALTER TABLE wa_knowledge_chunks ADD COLUMN embedding vector(${DIMS})`)
  } else if (col.dims !== DIMS) {
    throw new Error(`embedding column is vector(${col.dims}), expected vector(${DIMS}); resize it before indexing`)
  }
  await db.query(
    'CREATE INDEX IF NOT EXISTS wa_knowledge_chunks_embedding_idx ON wa_knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)',
  )
  console.log(`pgvector: ready ✓ (wa_knowledge_chunks.embedding vector(${DIMS}))`)
  // Documents uploaded while pgvector was missing failed to index.
  const { rows: [{ failed }] } = await db.query("SELECT count(*)::int AS failed FROM wa_knowledge_docs WHERE status = 'error'")
  if (failed) console.log(`pgvector: ${failed} document(s) failed earlier — click Retry on them in AI Agent → Knowledge Base`)
} catch (err) {
  ok = false
  console.error('pgvector: FAILED —', err instanceof Error ? err.message : err)
} finally {
  await db.end().catch(() => {})
}

process.exit(ok ? 0 : 1)
