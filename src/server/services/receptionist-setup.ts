import 'server-only'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { prisma } from '@/server/db/client'
import { getEffectivePermissions } from '@/server/auth/permissions'
import { AppError } from '@/lib/errors'
import { receptionistConfigSchema } from '@/lib/receptionist'
import { setupBusinessSchema, setupBusinessWriteSchema, setupLaunchSchema, setupSnapshotSchema } from '@/lib/receptionist-setup'
import { getWebsiteReceptionistState, writeWebsiteReceptionistSettings } from './website-receptionist'
type Db = Prisma.TransactionClient
function fail(code: string, message: string, status = 409): never { throw new AppError(code, message, status) }
async function safe<T>(run: () => Promise<T>): Promise<T> { try { return await run() } catch (error) { if (error instanceof AppError || error instanceof ZodError) throw error; if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') fail('SETUP_CONFLICT', 'Business settings were created elsewhere. Reload before saving.'); throw new AppError('SETUP_UNAVAILABLE', 'Setup is unavailable. Reload the saved state before trying again.', 503) } }
async function authorize(organizationId: string, userId: string, db: Db = prisma) {
  const member = await db.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { id: true } })
  if (!member || !(await getEffectivePermissions(userId, organizationId)).has('admin:settings')) fail('FORBIDDEN', 'Organization administrator access is required.', 403)
}
const approvedWhere = (organizationId: string, db: Db) => ({ organizationId, archivedAt: null, publishedAt: { not: null }, publishedText: { not: null }, publishedRevision: { not: null }, receptionistApprovedRevision: { equals: db.knowledgeDocument.fields.publishedRevision } })
async function snapshot(organizationId: string, db: Db) {
  const [stored, organization, website, documents, approved, samples, published, provider] = await Promise.all([
    db.receptionistConfig.findUnique({ where: { organizationId }, select: { settings: true, updatedAt: true } }),
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } }),
    getWebsiteReceptionistState(organizationId, db),
    db.knowledgeDocument.findMany({ where: { organizationId, archivedAt: null }, select: { id: true, revision: true, publishedRevision: true, receptionistApprovedRevision: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    db.knowledgeDocument.findMany({ where: approvedWhere(organizationId, db), select: { publishedCategory: true } }),
    db.knowledgeDocument.findMany({ where: approvedWhere(organizationId, db), select: { publishedCategory: true, publishedText: true }, orderBy: { id: 'asc' }, take: 3 }),
    db.knowledgeDocument.count({ where: { organizationId, archivedAt: null, publishedAt: { not: null }, publishedText: { not: null }, publishedRevision: { not: null } } }),
    db.aiProviderConfig.findUnique({ where: { organizationId }, select: { updatedAt: true } }),
  ])
  const parsed = stored ? receptionistConfigSchema.safeParse(stored.settings) : null
  if (stored && !parsed?.success) fail('SETUP_REPAIR_REQUIRED', 'Existing business settings need review in AI receptionist Settings. They were not reset.')
  const business = parsed?.success ? { businessName: parsed.data.businessName, timeZone: parsed.data.timeZone, opensAt: parsed.data.opensAt, closesAt: parsed.data.closesAt, businessDays: [...new Set(parsed.data.businessDays)].sort() } : { businessName: organization.name.trim().slice(0, 120), timeZone: 'UTC', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5] }
  const paragraphs = samples.flatMap(row => (row.publishedText ?? '').split(/\n\s*\n/).map(text => ({ category: row.publishedCategory ?? 'GENERAL', text: text.trim() }))).filter(row => row.text && Buffer.byteLength(row.text, 'utf8') <= 1200).sort((left, right) => right.text.length - left.text.length)
  const sample = paragraphs[0] ?? null
  const version = createHash('sha256').update(JSON.stringify({ businessVersion: stored?.updatedAt ?? null, websiteVersion: website.settings?.updatedAt ?? null, documents, providerVersion: provider?.updatedAt ?? null, sample })).digest('hex')
  return setupSnapshotSchema.parse({ version, checkedAt: new Date().toISOString(), business: { values: business, saved: !!parsed?.success, updatedAt: stored?.updatedAt.toISOString() ?? null, phoneEnabled: parsed?.success ? parsed.data.enabled : false }, website,
    knowledge: { total: documents.length, published, approved: website.approvedDocuments, approvedCategories: [...new Set(approved.map(row => row.publishedCategory ?? 'GENERAL'))].sort(), sample },
    readyToEnable: !!parsed?.success && website.hasOrganizationAi && website.approvedDocuments > 0 && !!website.settings?.allowedOrigins.length,
  })
}
export async function getReceptionistSetup(organizationId: string, userId: string) { return safe(async () => { await authorize(organizationId, userId); return prisma.$transaction(db => snapshot(organizationId, db), { isolationLevel: 'RepeatableRead' }) }) }
export async function saveReceptionistSetupBusiness(organizationId: string, userId: string, raw: unknown) {
  return safe(async () => {
    await authorize(organizationId, userId); const input = setupBusinessWriteSchema.parse(raw)
    return prisma.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM "Organization" WHERE id=${organizationId} FOR NO KEY UPDATE`
      await db.$queryRaw`SELECT id FROM "ReceptionistConfig" WHERE "organizationId"=${organizationId} FOR UPDATE`
      await authorize(organizationId, userId, db)
      const current = await db.receptionistConfig.findUnique({ where: { organizationId } })
      if ((current?.updatedAt.toISOString() ?? null) !== input.expectedUpdatedAt) fail('SETUP_CONFLICT', 'Business settings changed. Reload before saving; your local edits can be kept.')
      const existing = current ? receptionistConfigSchema.safeParse(current.settings) : null
      if (current && !existing?.success) fail('SETUP_REPAIR_REQUIRED', 'Existing business settings need review in AI receptionist Settings. They were not reset.')
      const defaults = { enabled: false, knowledge: '', mode: 'always' as const, forwardTo: '', assigneeId: '', stageId: '' }
      const settings = { ...(existing?.success ? current!.settings as Prisma.JsonObject : defaults), ...setupBusinessSchema.parse(input.values) }
      receptionistConfigSchema.parse(settings)
      const updatedAt = new Date(Math.max(Date.now(), (current?.updatedAt.getTime() ?? 0) + 1))
      if (current) await db.receptionistConfig.update({ where: { organizationId }, data: { settings, updatedAt } })
      else await db.receptionistConfig.create({ data: { organizationId, settings, updatedAt } })
      return snapshot(organizationId, db)
    }, { timeout: 10000 })
  })
}
export async function launchReceptionistSetup(organizationId: string, userId: string, raw: unknown) {
  return safe(async () => {
    await authorize(organizationId, userId); const input = setupLaunchSchema.parse(raw)
    return prisma.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM "Organization" WHERE id=${organizationId} FOR NO KEY UPDATE`
      await db.$queryRaw`SELECT id FROM "ReceptionistConfig" WHERE "organizationId"=${organizationId} FOR SHARE`
      await db.$queryRaw`SELECT id FROM "KnowledgeDocument" WHERE "organizationId"=${organizationId} ORDER BY id FOR SHARE`
      await db.$queryRaw`SELECT "organizationId" FROM "AiProviderConfig" WHERE "organizationId"=${organizationId} FOR SHARE`
      await authorize(organizationId, userId, db)
      const current = await snapshot(organizationId, db)
      if (current.website.settings?.enabled) return current
      if (current.version !== input.expectedVersion) fail('SETUP_CONFLICT', 'The saved setup changed. Reload and repeat the simulation before enabling.')
      if (!current.readyToEnable || !current.website.settings) fail('SETUP_NOT_READY', 'Save business details, approve published knowledge, configure organization AI, and save allowed websites before enabling.', 400)
      const config = current.website.settings
      await writeWebsiteReceptionistSettings(organizationId, { enabled: true, allowedOrigins: config.allowedOrigins, dailyMessageLimit: config.dailyMessageLimit, dailyTokenLimit: config.dailyTokenLimit, dailyCallbackLimit: config.dailyCallbackLimit, expectedUpdatedAt: config.updatedAt, acknowledged: true }, db)
      return snapshot(organizationId, db)
    }, { timeout: 10000 })
  })
}
