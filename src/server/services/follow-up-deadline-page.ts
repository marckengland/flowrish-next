import 'server-only'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { AppError } from '@/lib/errors'

export const followUpOrderChanged = () => new AppError('FOLLOW_UP_ORDER_CHANGED', 'Task deadlines or matching work changed. Refresh the list before loading more; unsent drafts are kept.', 409)
type Anchor = { id: string; createdAt: Date; dueDate?: Date | null; orderVersion?: string }
const fingerprint = Prisma.sql`encode(sha256(convert_to(coalesce(string_agg(json_build_array(id,"createdAt","progressTaskId","progressDueDate","progressComplete")::text,E'\n' ORDER BY id),''),'UTF8')),'hex')`
const versionSchema = z.string().regex(/^[a-f0-9]{64}$/)
const rowSchema = z.object({ id: z.string().uuid(), createdAt: z.string().datetime(), dueDate: z.string().datetime().nullable(), isPage: z.boolean(), hasMore: z.boolean() }).strict()
/** The fingerprint includes the complete authorized matching set, before position/LIMIT. */
export async function readDeadlineVersion(db: Prisma.TransactionClient, eligible: Prisma.Sql, predicate: Prisma.Sql) {
 const rows = await db.$queryRaw<Array<{ orderVersion: string }>>(Prisma.sql`WITH eligible AS (${eligible}), matching AS (SELECT * FROM eligible WHERE ${predicate}) SELECT ${fingerprint} AS "orderVersion" FROM matching`)
 return versionSchema.parse(rows[0]?.orderVersion)
}
export async function readDeadlinePage(db: Prisma.TransactionClient, eligible: Prisma.Sql, predicate: Prisma.Sql, retained: readonly string[], after: Anchor | null) {
 const tie = after ? Prisma.sql`("createdAt"<${after.createdAt} OR ("createdAt"=${after.createdAt} AND id>${after.id}))` : Prisma.sql`TRUE`
 const position = !after ? Prisma.sql`TRUE` : after.dueDate ? Prisma.sql`("progressDueDate">${after.dueDate} OR "progressDueDate" IS NULL OR ("progressDueDate"=${after.dueDate} AND ${tie}))` : Prisma.sql`("progressDueDate" IS NULL AND ${tie})`
 const retain = retained.length ? Prisma.sql`id IN (${Prisma.join(retained)})` : Prisma.sql`FALSE`
 const result = await db.$queryRaw<Array<{ keys: unknown; orderVersion: string }>>(Prisma.sql`WITH eligible AS (${eligible}), matching AS (SELECT * FROM eligible WHERE ${predicate}),
 page_candidates AS (SELECT * FROM matching WHERE ${position} ORDER BY "progressDueDate" ASC NULLS LAST,"createdAt" DESC,id ASC LIMIT 101),
 selected AS ((SELECT id,"createdAt","progressDueDate",true AS "isPage" FROM page_candidates ORDER BY "progressDueDate" ASC NULLS LAST,"createdAt" DESC,id ASC LIMIT 100)
 UNION ALL SELECT id,"createdAt","progressDueDate",false AS "isPage" FROM eligible WHERE ${retain}),
 keys AS (SELECT id,"createdAt","progressDueDate",bool_or("isPage") AS "isPage" FROM selected GROUP BY id,"createdAt","progressDueDate")
 SELECT (SELECT ${fingerprint} FROM matching) AS "orderVersion",coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'createdAt',to_char("createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'dueDate',to_char("progressDueDate",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'isPage',"isPage",'hasMore',(SELECT count(*)>100 FROM page_candidates)) ORDER BY "progressDueDate" ASC NULLS LAST,"createdAt" DESC,id ASC) FROM keys),'[]'::jsonb) AS keys`)
 const orderVersion = versionSchema.parse(result[0]?.orderVersion)
 if (after && after.orderVersion !== orderVersion) throw followUpOrderChanged()
 const keys = z.array(rowSchema).max(200).parse(result[0]?.keys).map(row => ({ ...row, createdAt: new Date(row.createdAt), dueDate: row.dueDate === null ? null : new Date(row.dueDate) }))
 return { keys, orderVersion }
}
