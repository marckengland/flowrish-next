import { PrismaClient } from '@prisma/client'

/**
 * Global Prisma client singleton.
 * Uses globalThis to survive hot-reload in development (Next.js dev server
 * re-evaluates modules but preserves globalThis between reloads).
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
