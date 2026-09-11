import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    // Production connection pool tuning
    max: 20,                  // max open connections (Postgres default is 100, keep headroom)
    idleTimeoutMillis: 30000, // close idle connections after 30s to free resources
    connectionTimeoutMillis: 5000, // fail fast after 5s if no connection available
    keepAlive: true,          // detect dead connections via TCP keepalive
    keepAliveInitialDelayMillis: 10000,
  })
  const adapter = new PrismaPg(pool as any)

  // Safety: log which database this process is connected to (non-production only).
  // Credentials are redacted — only host, port, and database name are printed.
  if (process.env.NODE_ENV !== 'production') {
    try {
      const businessType = process.env.BUSINESS_TYPE || 'furniture'
      const dbUrl = process.env.DATABASE_URL
      if (dbUrl) {
        const parsed = new URL(dbUrl)
        const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname
        const dbName = parsed.pathname.replace(/^\//, '')
        console.log(`[db] BUSINESS_TYPE=${businessType} connected to host=${host} db=${dbName}`)
      } else {
        console.log(`[db] BUSINESS_TYPE=${businessType} connected to host=<unknown> db=<DATABASE_URL not set>`)
      }
    } catch {
      // Never let logging/parsing break startup.
      console.log('[db] could not parse DATABASE_URL for startup log (credentials redacted)')
    }
  }

  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
