/**
 * lib/ai-agent/retriever.ts
 *
 * pgvector cosine-similarity search over wa_knowledge_chunks.
 * The `embedding` column is NOT in the Prisma schema (pgvector isn't supported
 * natively), so we use a $queryRaw with the <=> operator.
 */

import { prisma } from '@/lib/db'

export interface RetrievedChunk {
  id: string
  content: string
  similarity: number
}

/**
 * Find the top-K most similar knowledge chunks for a given user.
 *
 * @param userId        - The CRM user whose knowledge base to search.
 * @param queryEmbedding - The embedding vector of the incoming customer message.
 * @param topK          - Maximum number of chunks to return (default 3).
 * @param minSimilarity - Cosine similarity threshold (default 0.4).
 */
export async function retrieveChunks(
  userId: string,
  queryEmbedding: number[],
  topK = 3,
  minSimilarity = 0.4,
): Promise<RetrievedChunk[]> {
  // MUST use $queryRawUnsafe — Prisma's tagged-template $queryRaw binds the
  // vector literal as a text parameter ($1::text) which the pg driver cannot
  // implicitly cast to the vector type. The literal is built server-side from
  // a number[] so there is no SQL-injection risk.
  const vectorLiteral = `[${queryEmbedding.join(',')}]`

  const rows = await prisma.$queryRawUnsafe<RetrievedChunk[]>(`
    SELECT
      id,
      content,
      1 - (embedding <=> $1::vector) AS similarity
    FROM wa_knowledge_chunks
    WHERE
      user_id = $2
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> $1::vector) >= $3
    ORDER BY embedding <=> $1::vector
    LIMIT $4
  `, vectorLiteral, userId, minSimilarity, topK)

  return rows
}
