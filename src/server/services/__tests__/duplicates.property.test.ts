import { beforeEach, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import type { Prisma } from '@prisma/client'
const transaction = vi.hoisted(() => vi.fn())
vi.mock('@/server/db/client', () => ({ prisma: { $transaction: transaction } }))
import { transferMergeRecords } from '../lead-merge-transfer'
import { previewLeadMerge } from '../lead-merge'
import { relationTables, type Related, type RelatedRow } from '../lead-merge-snapshot'
const scenario = fc.record({ ids: fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 20 }), primaryContacts: fc.uniqueArray(fc.uuid(), { maxLength: 6 }), secondaryContacts: fc.uniqueArray(fc.uuid(), { maxLength: 6 }) }).map(value => ({ ...value, secondaryContacts: [...new Set([...value.secondaryContacts, ...value.primaryContacts.slice(0, 2)])] }))
function setup(value: { ids: string[]; primaryContacts: string[]; secondaryContacts: string[] }) {
  const primaryId = value.ids[0], secondaryId = value.ids[1], cut = Math.floor(value.ids.length / 2)
  const related = Object.fromEntries(relationTables.map(table => [table, []])) as unknown as Related
  const row = (id: string, leadId: string): RelatedRow => ({ id, leadId, hash: 'a'.repeat(64), organizationId: 'org' })
  related.Activity = value.ids.map((id, index) => row(id, index < cut ? primaryId : secondaryId))
  related.LeadContact = [...value.primaryContacts.map(id => row(id, primaryId)), ...value.secondaryContacts.map(id => row(id, secondaryId))]
  const records = structuredClone(related), updateMany = vi.fn(async ({ where, data }: any) => { expect(where.organizationId).toBe('org'); const chosen = records.Activity.filter(row => row.leadId === where.leadId && where.id.in.includes(row.id)); chosen.forEach(row => { row.leadId = data.leadId }); return { count: chosen.length } })
  const createMany = vi.fn(async ({ data }: any) => { records.LeadContact.push(...data.map((link: any) => row(link.contactId, link.leadId))); return { count: data.length } })
  const lead = { updateMany: vi.fn(), delete: vi.fn() }
  const db = { activity: { updateMany }, leadContact: { createMany }, lead } as unknown as Prisma.TransactionClient
  return { primaryId, secondaryId, related, records, db, updateMany, createMany, lead }
}
beforeEach(() => vi.clearAllMocks())
it('merged primary lead contains the union of both activity sets', async () => {
  await fc.assert(fc.asyncProperty(scenario, async value => { const s = setup(value); await transferMergeRecords(s.db, 'org', s.primaryId, s.secondaryId, s.related, new Date()); expect(new Set(s.records.Activity.filter(row => row.leadId === s.primaryId).map(row => row.id))).toEqual(new Set(value.ids)) }))
})
it('secondary activities are reassigned only to the retained lead within the business', async () => {
  await fc.assert(fc.asyncProperty(scenario, async value => { const s = setup(value); await transferMergeRecords(s.db, 'org', s.primaryId, s.secondaryId, s.related, new Date()); expect(s.records.Activity.every(row => row.leadId === s.primaryId)).toBe(true); expect(s.records.Activity.some(row => row.leadId === s.secondaryId)).toBe(false) }))
})
it('does not recreate contact links already present on primary', async () => {
  await fc.assert(fc.asyncProperty(scenario, async value => { const s = setup(value); await transferMergeRecords(s.db, 'org', s.primaryId, s.secondaryId, s.related, new Date()); const created = s.createMany.mock.calls.flatMap(call => call[0].data.map((link: any) => link.contactId)); expect(created.some(id => value.primaryContacts.includes(id))).toBe(false) }))
})
it('retained contacts are a duplicate-free union and original archive links remain intact', async () => {
  await fc.assert(fc.asyncProperty(scenario, async value => { const s = setup(value); await transferMergeRecords(s.db, 'org', s.primaryId, s.secondaryId, s.related, new Date()); const ids = s.records.LeadContact.filter(row => row.leadId === s.primaryId).map(row => row.id); expect(new Set(ids)).toEqual(new Set([...value.primaryContacts, ...value.secondaryContacts])); expect(ids.length).toBe(new Set(ids).size); expect(s.records.LeadContact.filter(row => row.leadId === s.secondaryId).map(row => row.id)).toEqual(value.secondaryContacts) }))
})
it('self-merge always reports SELF_MERGE', async () => { await fc.assert(fc.asyncProperty(fc.uuid(), async id => { await expect(previewLeadMerge('org', 'user', { id, primaryId: id, secondaryId: id })).rejects.toMatchObject({ code: 'SELF_MERGE' }) })) })
it('self-merge never reaches the database', async () => { await fc.assert(fc.asyncProperty(fc.uuid(), async id => { await previewLeadMerge('org', 'user', { id, primaryId: id, secondaryId: id }).catch(() => undefined); expect(transaction).not.toHaveBeenCalled() })) })
it('self-merge retains the 400 response contract', async () => { await fc.assert(fc.asyncProperty(fc.uuid(), async id => { await expect(previewLeadMerge('org', 'user', { id, primaryId: id, secondaryId: id })).rejects.toMatchObject({ statusCode: 400 }) })) })
it('relation transfer never changes primary fields or deletes a lead', async () => { await fc.assert(fc.asyncProperty(scenario, async value => { const s = setup(value); await transferMergeRecords(s.db, 'org', s.primaryId, s.secondaryId, s.related, new Date()); expect(s.lead.updateMany).not.toHaveBeenCalled(); expect(s.lead.delete).not.toHaveBeenCalled() })) })
