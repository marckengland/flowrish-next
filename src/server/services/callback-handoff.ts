import 'server-only'
import { createHash } from 'node:crypto'
import { Prisma, type CallbackCrmHandoff } from '@prisma/client'
import { z, ZodError } from 'zod'
import { prisma } from '@/server/db/client'
import { preferredTimeSchema, preferredTimeLabel } from '@/lib/callback-time'
import { readCallbackCalendar, checkCallbackTime, validateCallbackInstant } from './callback-time'
import { getEffectivePermissions } from '@/server/auth/permissions'
import { AppError } from '@/lib/errors'
import { websiteCallbackRecordSchema } from '@/lib/website-receptionist'
import { handoffDraftSchema, handoffCommitSchema, handoffOptionsSchema, handoffPreviewSchema, handoffReceiptSchema, type HandoffDraft, type HandoffOptions } from '@/lib/callback-handoff'

type Db = Prisma.TransactionClient
const uuid = z.string().uuid()
const activeLead = { deletedAt: null, isClosed: false }
const label = (value: string) => value.replace(/[\0\r\n]/g, ' ').trim().slice(0, 512) || 'Unnamed record'
function fail(code = 'HANDOFF_INVALID', message = 'Reload the handoff choices and choose valid organization records.', status = 400): never { throw new AppError(code, message, status) }
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action() } catch (error) { if (error instanceof AppError || error instanceof ZodError) throw error; throw new AppError('HANDOFF_UNAVAILABLE', 'The handoff could not be confirmed. Reload its status before trying again.', 503) } }
async function authorize(organizationId: string, userId: string, db: Db = prisma) {
  const membership = await db.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { id: true } })
  const permissions = membership ? await getEffectivePermissions(userId, organizationId) : new Set<string>()
  if (!(['admin:settings', 'leads:read', 'leads:write', 'contacts:read'] as const).every(key => permissions.has(key))) fail('FORBIDDEN', 'CRM handoff requires organization administrator and CRM permissions.', 403)
}
async function receiptView(row: CallbackCrmHandoff, db: Db) {
  const [lead, task] = await Promise.all([
    db.lead.findFirst({ where: { id: row.leadId, organizationId: row.organizationId, deletedAt: null }, select: { id: true } }),
    db.task.findFirst({ where: { id: row.taskId, organizationId: row.organizationId, lead: { organizationId: row.organizationId, deletedAt: null } }, select: { id: true } }),
  ])
  return handoffReceiptSchema.parse({ callbackId: row.callbackId, leadId: row.leadId, taskId: row.taskId, createdAt: row.createdAt.toISOString(), leadAvailable: !!lead, taskAvailable: !!task, ...(row.preferredTime ? { preferredTime: preferredTimeSchema.parse(row.preferredTime) } : {}) })
}
async function options(organizationId: string, callbackId: string, db: Db, lockCalendar = false) {
  const [callback, receipt] = await Promise.all([
    db.websiteReceptionistCallback.findFirst({ where: { id: callbackId, organizationId } }),
    db.callbackCrmHandoff.findFirst({ where: { callbackId, organizationId } }),
  ])
  if (!callback && !receipt) fail('NOT_FOUND', 'Callback request not found.', 404)
  const callbackView = callback ? websiteCallbackRecordSchema.parse({ ...Object.fromEntries(['id', 'fullName', 'phone', 'reason', 'siteOrigin', 'status'].map(key => [key, callback[key as keyof typeof callback]])), consentedAt: callback.consentedAt.toISOString(), createdAt: callback.createdAt.toISOString(), updatedAt: callback.updatedAt.toISOString(), ...(callback.preferredTime ? { preferredTime: preferredTimeSchema.parse(callback.preferredTime) } : {}) }) : null
  if (receipt) return { data: handoffOptionsSchema.parse({ callback: callbackView, receipt: await receiptView(receipt, db), leads: [], contacts: [], members: [], stages: [], matchesTruncated: false, choicesTruncated: false }), snapshot: null }
  const callbackHours = callbackView?.preferredTime ? await readCallbackCalendar(organizationId, db, lockCalendar) : null
  const digits = callback!.phone.replace(/\D/g, '')
  const [matchedLeads, matchedContacts, members, stages] = await Promise.all([
    db.$queryRaw<{ id: string }[]>`SELECT l.id FROM "Lead" l WHERE l."organizationId"=${organizationId} AND l."deletedAt" IS NULL AND NOT l."isClosed" AND (regexp_replace(coalesce(l.phone,''),'[^0-9]','','g')=${digits} OR EXISTS (SELECT 1 FROM "LeadContact" lc JOIN "Contact" c ON c.id=lc."contactId" WHERE lc."leadId"=l.id AND c."organizationId"=${organizationId} AND regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')=${digits})) ORDER BY l.id LIMIT 21`,
    db.$queryRaw<{ id: string }[]>`SELECT id FROM "Contact" WHERE "organizationId"=${organizationId} AND regexp_replace(coalesce(phone,''),'[^0-9]','','g')=${digits} ORDER BY id LIMIT 21`,
    db.organizationMember.findMany({ where: { organizationId }, include: { user: { select: { name: true } } }, orderBy: { userId: 'asc' }, take: 201 }),
    db.stage.findMany({ where: { pipeline: { organizationId }, isClosedWon: false, isClosedLost: false }, include: { pipeline: { select: { name: true } } }, orderBy: [{ pipelineId: 'asc' }, { order: 'asc' }], take: 201 }),
  ])
  const [leads, contacts] = await Promise.all([
    db.lead.findMany({ where: { id: { in: matchedLeads.slice(0, 20).map(row => row.id) }, organizationId, ...activeLead }, orderBy: { id: 'asc' }, select: { id: true, firstName: true, lastName: true, phone: true, updatedAt: true } }),
    db.contact.findMany({ where: { id: { in: matchedContacts.slice(0, 20).map(row => row.id) }, organizationId }, orderBy: { id: 'asc' }, select: { id: true, firstName: true, lastName: true, phone: true, updatedAt: true, leads: { where: { lead: { organizationId, ...activeLead } }, select: { leadId: true }, orderBy: { leadId: 'asc' }, take: 21 } } }),
  ])
  const data: HandoffOptions = handoffOptionsSchema.parse({
    callback: callbackView, receipt: null,
    leads: leads.map(row => ({ id: row.id, label: label(`${row.firstName} ${row.lastName} · ${row.phone ?? ''}`) })),
    contacts: contacts.map(row => ({ id: row.id, label: label(`${row.firstName} ${row.lastName} · ${row.phone ?? ''}`), leadIds: row.leads.slice(0, 20).map(link => link.leadId) })),
    members: members.slice(0, 200).map(row => ({ id: row.userId, label: label(row.user.name) })),
    stages: stages.slice(0, 200).map(row => ({ id: row.id, label: label(`${row.pipeline.name} / ${row.name}`) })),
    matchesTruncated: matchedLeads.length > 20 || matchedContacts.length > 20 || contacts.some(row => row.leads.length > 20), choicesTruncated: members.length > 200 || stages.length > 200, ...(callbackHours ? { callbackHours } : {}),
  })
  return { data, snapshot: { leads, contacts } }
}
export async function getCallbackHandoffOptions(organizationId: string, userId: string, callbackId: string) { return safe(async () => { uuid.parse(callbackId); await authorize(organizationId, userId); return prisma.$transaction(async db => (await options(organizationId, callbackId, db)).data, { isolationLevel: 'RepeatableRead' }) }) }

export async function getCallbackTaskSource(organizationId: string, userId: string, taskId: string) {
  return safe(async () => {
    uuid.parse(taskId); await authorize(organizationId, userId)
    const task = await prisma.task.findFirst({ where: { id: taskId, organizationId, lead: { organizationId, deletedAt: null } }, select: { id: true } })
    if (!task) fail('NOT_FOUND', 'Task not found.', 404)
    const receipt = await prisma.callbackCrmHandoff.findFirst({ where: { taskId, organizationId }, select: { callbackId: true, taskId: true } })
    return receipt
  })
}

async function preview(organizationId: string, callbackId: string, draft: HandoffDraft, db: Db, lockCalendar = false) {
  if (new Date(draft.dueDate).getTime() <= Date.now()) fail('HANDOFF_INVALID', 'Choose a future callback deadline.')
  const state = await options(organizationId, callbackId, db, lockCalendar), { data } = state
  if (data.receipt) fail('HANDOFF_ALREADY_DONE', 'This callback already has a CRM handoff. Reload its status.', 409)
  const callback = data.callback!
  if (callback.updatedAt !== draft.expectedUpdatedAt) fail('HANDOFF_CONFLICT', 'The callback changed. Reload its details before reviewing again.', 409)
  const member = data.members.find(row => row.id === draft.assigneeId)
  if (!member) fail()
  let targetLabel: string, contactLabel: string | null = null
  const target = draft.target
  if (target.mode === 'lead') {
    const lead = data.leads.find(row => row.id === target.leadId)
    if (!lead) fail()
    targetLabel = lead.label
  } else {
    const stage = data.stages.find(row => row.id === target.stageId)
    if (!stage) fail()
    if ((data.leads.length || data.contacts.length || data.matchesTruncated) && !draft.acknowledgeDuplicate) fail('HANDOFF_DUPLICATE', 'Review the existing matches and acknowledge creating another lead.')
    if (target.contactId) { const contact = data.contacts.find(row => row.id === target.contactId); if (!contact) fail(); contactLabel = contact.label }
    targetLabel = `New lead: ${target.firstName} ${target.lastName} · ${stage.label}`
  }
  const confirmedTime = callback.preferredTime ? checkCallbackTime(data.callbackHours ?? null, calendar => validateCallbackInstant(draft.dueDate, calendar)) : undefined
  const taskTitle = `Callback: ${callback.fullName}`.replace(/[\0\r\n]/g, ' ')
  const taskDescription = [`Visitor: ${callback.fullName}`, `Phone: ${callback.phone}`, `Request: ${callback.reason}`, `Website: ${callback.siteOrigin}`, `Contact consent confirmed: ${callback.consentedAt}`, `Source callback: ${callback.id}`, `Source: /settings?section=receptionist&callback=${callback.id}`, 'Staff-approved handoff. No call or message has been sent.', ...(confirmedTime ? [`Requested callback time: ${preferredTimeLabel(callback.preferredTime!)}`, `Staff-confirmed callback time at handoff: ${preferredTimeLabel(confirmedTime)}`] : [])].join('\n')
  const version = createHash('sha256').update(JSON.stringify({ draft, options: data, snapshot: state.snapshot, taskTitle, taskDescription })).digest('hex')
  return handoffPreviewSchema.parse({ version, draft, targetLabel, contactLabel, assigneeName: member.label, taskTitle, taskDescription, ...(confirmedTime ? { preferredTime: callback.preferredTime, confirmedTime } : {}) })
}
export async function previewCallbackHandoff(organizationId: string, userId: string, callbackId: string, raw: unknown) { return safe(async () => { uuid.parse(callbackId); await authorize(organizationId, userId); const draft = handoffDraftSchema.parse(raw); return prisma.$transaction(db => preview(organizationId, callbackId, draft, db), { isolationLevel: 'RepeatableRead' }) }) }

export async function commitCallbackHandoff(organizationId: string, userId: string, callbackId: string, raw: unknown) {
  return safe(async () => {
    uuid.parse(callbackId); const input = handoffCommitSchema.parse(raw); await authorize(organizationId, userId)
    return prisma.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM "Organization" WHERE id=${organizationId} FOR NO KEY UPDATE`
      // Membership locks prevent removal of actor/assignee while committing the CRM write.
      const members = await db.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "OrganizationMember" WHERE "organizationId"=${organizationId} AND "userId" IN (${userId},${input.draft.assigneeId}) ORDER BY "userId" FOR SHARE`
      if (!members.some(row => row.userId === userId)) fail('FORBIDDEN', 'Organization membership is required.', 403)
      await authorize(organizationId, userId, db)
      const prior = await db.callbackCrmHandoff.findFirst({ where: { callbackId, organizationId } })
      if (prior) return receiptView(prior, db)
      if (!members.some(row => row.userId === input.draft.assigneeId)) fail()
      const source = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "WebsiteReceptionistCallback" WHERE id=${callbackId} AND "organizationId"=${organizationId} FOR UPDATE`
      if (!source.length) fail('NOT_FOUND', 'Callback request not found.', 404)
      const target = input.draft.target
      if (target.mode === 'lead') await db.$queryRaw`SELECT id FROM "Lead" WHERE id=${target.leadId} AND "organizationId"=${organizationId} FOR SHARE`
      else {
        await db.$queryRaw`SELECT s.id FROM "Stage" s JOIN "Pipeline" p ON p.id=s."pipelineId" WHERE s.id=${target.stageId} AND p."organizationId"=${organizationId} FOR SHARE OF s,p`
        if (target.contactId) await db.$queryRaw`SELECT id FROM "Contact" WHERE id=${target.contactId} AND "organizationId"=${organizationId} FOR SHARE`
      }
      const reviewed = await preview(organizationId, callbackId, input.draft, db, true)
      if (reviewed.version !== input.previewVersion) fail('HANDOFF_CONFLICT', 'The preview changed. Review the current details before confirming.', 409)
      let leadId: string
      if (target.mode === 'lead') leadId = target.leadId
      else {
        const lead = await db.lead.create({ data: { organizationId, firstName: target.firstName, lastName: target.lastName, phone: (await db.websiteReceptionistCallback.findUniqueOrThrow({ where: { id: callbackId } })).phone, description: reviewed.taskDescription, stageId: target.stageId, assignedUserId: input.draft.assigneeId, leadStatus: 'NEW' } })
        leadId = lead.id
        if (target.contactId) await db.leadContact.create({ data: { leadId, contactId: target.contactId } })
      }
      const task = await db.task.create({ data: { organizationId, leadId, assigneeId: input.draft.assigneeId, title: reviewed.taskTitle, description: reviewed.taskDescription, priority: 'MEDIUM', dueDate: new Date(input.draft.dueDate) } })
      const receipt = await db.callbackCrmHandoff.create({ data: { callbackId, organizationId, leadId, taskId: task.id, createdById: userId, ...(reviewed.preferredTime ? { preferredTime: reviewed.preferredTime } : {}) } })
      return receiptView(receipt, db)
    }, { timeout: 10000 })
  })
}
