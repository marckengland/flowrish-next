import { expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { readDeadlinePage, followUpOrderChanged } from '../follow-up-deadline-page'
const now = new Date('2026-11-06T00:00:00Z'), version = 'a'.repeat(64), id = '11111111-1111-4111-8111-111111111111'
it('orders before the bound and fingerprints all matching keys, not just the selected page', async () => {
 const query = vi.fn().mockResolvedValue([{ keys: [{ id, createdAt: now.toISOString(), dueDate: null, isPage: true, hasMore: false }], orderVersion: version }])
 const result = await readDeadlinePage({ $queryRaw: query } as never, Prisma.sql`SELECT 1`, Prisma.sql`status='APPROVED'`, ['retained'], null)
 expect(result).toEqual({ keys: [{ id, createdAt: now, dueDate: null, isPage: true, hasMore: false }], orderVersion: version })
 const sql = query.mock.calls[0][0] as Prisma.Sql
 expect(sql.text).toContain('NULLS LAST'); expect(sql.text.indexOf('NULLS LAST')).toBeLessThan(sql.text.indexOf('LIMIT 101')); expect(sql.text).toContain('FROM matching'); expect(sql.text).toContain('sha256'); expect(sql.values).toContain('retained')
})
it('rejects changed continuations and preserves an empty-page fingerprint', async () => {
 const db = { $queryRaw: vi.fn().mockResolvedValue([{ keys: [], orderVersion: version }]) }
 expect(await readDeadlinePage(db as never, Prisma.sql`SELECT 1`, Prisma.sql`TRUE`, [], null)).toEqual({ keys: [], orderVersion: version })
 await expect(readDeadlinePage(db as never, Prisma.sql`SELECT 1`, Prisma.sql`TRUE`, [], { id, createdAt: now, dueDate: null, orderVersion: 'b'.repeat(64) })).rejects.toMatchObject({ statusCode: 409, code: followUpOrderChanged().code })
 const sql = db.$queryRaw.mock.calls.at(-1)![0] as Prisma.Sql; expect(sql.text).toContain('"progressDueDate" IS NULL'); expect(sql.values).toContain(id)
})
it('does not return malformed dates, fingerprints or row shapes', async () => {
 for (const value of [{ keys: [], orderVersion: 'wrong' }, { keys: [{ id, createdAt: 'invalid', dueDate: null, isPage: true, hasMore: false }], orderVersion: version }]) await expect(readDeadlinePage({ $queryRaw: vi.fn().mockResolvedValue([value]) } as never, Prisma.sql`SELECT 1`, Prisma.sql`TRUE`, [], null)).rejects.toThrow()
})
