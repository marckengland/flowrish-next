import 'server-only'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { AppError } from '@/lib/errors'
import { MERGE_RELATED_LIMIT } from '@/lib/lead-merge'
export const movedTables = ['Activity', 'Task', 'StageTransition', 'ScoreHistory'] as const
export const blockedTables = ['CadenceEnrollment', 'FollowUpSuggestion', 'ReceptionistCall', 'WaitlistCrmHandoff', 'CallbackCrmHandoff'] as const
export const relationTables = [...movedTables, 'LeadContact', ...blockedTables] as const
export type RelatedRow = { id: string; leadId: string; hash: string; organizationId: string | null }
export type Related = Record<typeof relationTables[number], RelatedRow[]>
export const mergeConflict = () => new AppError('MERGE_CHANGED', 'The records, linked work or access changed. Prepare a fresh review. Nothing was merged.', 409)
export const mergeDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export async function mergeRelated(db: Prisma.TransactionClient, organizationId: string, ids: string[], lock = false): Promise<Related> {
  const result = {} as Related
  for (const table of relationTables) {
    const contact = table === 'LeadContact'
    const key = contact ? 'contactId' : table === 'CallbackCrmHandoff' ? 'callbackId' : table === 'WaitlistCrmHandoff' ? 'waitlistId' : 'id'
    const rows = await db.$queryRaw<RelatedRow[]>(Prisma.sql`SELECT ${Prisma.raw(`r."${key}"`)} AS id, r."leadId", ${Prisma.raw(contact ? 'c."organizationId"' : 'r."organizationId"')} AS "organizationId", encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS hash FROM ${Prisma.raw(`"${table}"`)} r ${contact ? Prisma.raw('JOIN "Contact" c ON c.id=r."contactId"') : Prisma.empty} WHERE r."leadId" IN (${Prisma.join(ids)}) ORDER BY r."leadId", ${Prisma.raw(`r."${key}"`)} LIMIT 501 ${lock ? Prisma.raw('FOR UPDATE OF r') : Prisma.empty}`)
    if (rows.some(row => row.organizationId !== organizationId)) throw mergeConflict()
    result[table] = rows
  }
  const size = Object.values(result).reduce((sum, rows) => sum + rows.length, 0)
  if (size > MERGE_RELATED_LIMIT) throw new AppError('MERGE_TOO_LARGE', 'This merge has too much linked work for a safe review. Contact an administrator.', 413)
  return result
}
export function missingMergeContacts(related: Related, primaryId: string, secondaryId: string) {
  const existing = new Set(related.LeadContact.filter(row => row.leadId === primaryId).map(row => row.id))
  return related.LeadContact.filter(row => row.leadId === secondaryId && !existing.has(row.id)).map(row => row.id)
}
export function countsForMerge(related: Related, primaryId: string, secondaryId: string) {
  return { Activity: related.Activity.filter(row => row.leadId === secondaryId).length, Task: related.Task.filter(row => row.leadId === secondaryId).length, StageTransition: related.StageTransition.filter(row => row.leadId === secondaryId).length, ScoreHistory: related.ScoreHistory.filter(row => row.leadId === secondaryId).length, LeadContact: missingMergeContacts(related, primaryId, secondaryId).length }
}
export async function mergeLeadHashes(db: Prisma.TransactionClient, organizationId: string, ids: string[]) {
  return db.$queryRaw<Array<{ id: string; hash: string }>>(Prisma.sql`SELECT r.id, encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS hash FROM "Lead" r WHERE r."organizationId"=${organizationId} AND r.id IN (${Prisma.join(ids)}) ORDER BY r.id`)
}
