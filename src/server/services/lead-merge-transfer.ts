import 'server-only'
import type { Prisma } from '@prisma/client'
import { countsForMerge, mergeConflict, missingMergeContacts, movedTables, type Related } from './lead-merge-snapshot'
/** Called only inside the reviewed merge transaction after scope/version/link locks. */
export async function transferMergeRecords(db: Prisma.TransactionClient, organizationId: string, primaryId: string, secondaryId: string, related: Related, stamp: Date) {
  for (const table of movedTables) {
    const ids = related[table].filter(row => row.leadId === secondaryId).map(row => row.id)
    if (!ids.length) continue
    const where = { organizationId, leadId: secondaryId, id: { in: ids } }, data = { leadId: primaryId }
    const result = table === 'Activity' ? await db.activity.updateMany({ where, data }) : table === 'Task' ? await db.task.updateMany({ where, data: { ...data, updatedAt: stamp } }) : table === 'StageTransition' ? await db.stageTransition.updateMany({ where, data }) : await db.scoreHistory.updateMany({ where, data })
    if (result.count !== ids.length) throw mergeConflict()
  }
  const copiedContacts = missingMergeContacts(related, primaryId, secondaryId)
  if (copiedContacts.length) {
    const result = await db.leadContact.createMany({ data: copiedContacts.map(contactId => ({ leadId: primaryId, contactId })) })
    if (result.count !== copiedContacts.length) throw mergeConflict()
  }
  return { counts: countsForMerge(related, primaryId, secondaryId), copiedContacts }
}
