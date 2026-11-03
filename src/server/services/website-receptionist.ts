import 'server-only'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { Prisma, type WebsiteReceptionistConfig } from '@prisma/client'
import { z, ZodError } from 'zod'
import { prisma } from '@/server/db/client'
import { getEffectivePermissions } from '@/server/auth/permissions'
import { AppError } from '@/lib/errors'
import { aiProviderSettingsSchema } from '@/lib/ai-provider'
import { receptionistConfigSchema, receptionistGreeting } from '@/lib/receptionist'
import { websiteReceptionistSaveSchema, websiteSettingsSchema, websiteSessionInputSchema, websiteMessageInputSchema, websiteMessageResultSchema, websiteCallbackInputSchema, websiteCallbackQuerySchema, websiteCallbackReviewSchema, websiteCallbackRecordSchema, websiteOriginSchema, WEBSITE_REPLY_RESERVATION, WEBSITE_SESSION_TURNS, type WebsiteReceptionistAdminData, type WebsiteRequestContext, type WebsiteEmbedData, type WebsiteMessageResult } from '@/lib/website-receptionist'
import { generateWebsiteReceptionistAnswer } from './website-receptionist-generation'

const idSchema = z.string().uuid()
const fallback = 'I cannot answer right now. You can submit a callback request for the business to review.'
const emptyUsage = { sessions: 0, messages: 0, reservedTokens: 0, callbacks: 0 }
type Tx = Prisma.TransactionClient
const dayUtc = (at = new Date()) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
function fail(code = 'WEBSITE_UNAVAILABLE', status = 403): never { throw new AppError(code, 'Website receptionist is unavailable. Please reload or contact the business directly.', status) }
async function safe<T>(run: () => Promise<T>): Promise<T> {
  try { return await run() } catch (error) {
    if (error instanceof AppError || error instanceof ZodError) throw error
    throw new AppError('WEBSITE_UNAVAILABLE', 'Website receptionist is temporarily unavailable.', 503)
  }
}
async function admin(organizationId: string, userId: string) {
  const member = await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { id: true } })
  if (!member || !(await getEffectivePermissions(userId, organizationId)).has('admin:settings')) throw new AppError('FORBIDDEN', 'Administrator access to this organization is required.', 403)
}
async function readiness(organizationId: string, db: Tx = prisma) {
  const [business, ai, approvedDocuments] = await Promise.all([
    db.receptionistConfig.findUnique({ where: { organizationId }, select: { settings: true } }),
    db.aiProviderConfig.findUnique({ where: { organizationId }, select: { provider: true, model: true, enabled: true, dailyRequestLimit: true, dailyTokenLimit: true, maxOutputTokens: true, maxInputBytes: true, updatedAt: true } }),
    db.knowledgeDocument.count({ where: { organizationId, archivedAt: null, publishedAt: { not: null }, publishedText: { not: null }, publishedRevision: { not: null }, receptionistApprovedRevision: { equals: db.knowledgeDocument.fields.publishedRevision } } }),
  ])
  const parsed = receptionistConfigSchema.safeParse(business?.settings)
  const aiValid = ai?.enabled && aiProviderSettingsSchema.safeParse({ provider: ai.provider, model: ai.model, enabled: ai.enabled, dailyRequestLimit: ai.dailyRequestLimit, dailyTokenLimit: ai.dailyTokenLimit, maxOutputTokens: ai.maxOutputTokens, maxInputBytes: ai.maxInputBytes, expectedUpdatedAt: ai.updatedAt.toISOString() }).success
  return { hasSavedBusiness: parsed.success, businessName: parsed.success ? parsed.data.businessName : '', approvedDocuments, hasOrganizationAi: !!aiValid }
}
function settings(config: WebsiteReceptionistConfig) { return websiteSettingsSchema.parse({ publicId: config.publicId, enabled: config.enabled, allowedOrigins: config.allowedOrigins, dailyMessageLimit: config.dailyMessageLimit, dailyTokenLimit: config.dailyTokenLimit, dailyCallbackLimit: config.dailyCallbackLimit, updatedAt: config.updatedAt.toISOString() }) }
export async function getWebsiteReceptionistState(organizationId: string, db: Tx = prisma): Promise<WebsiteReceptionistAdminData> {
  const [config, ready, usage] = await Promise.all([db.websiteReceptionistConfig.findUnique({ where: { organizationId } }), readiness(organizationId, db), db.websiteReceptionistUsage.findUnique({ where: { organizationId_day_scope: { organizationId, day: dayUtc(), scope: 'org' } }, select: { sessions: true, messages: true, reservedTokens: true, callbacks: true } })])
  return { settings: config ? settings(config) : null, hasSavedBusiness: ready.hasSavedBusiness, approvedDocuments: ready.approvedDocuments, hasOrganizationAi: ready.hasOrganizationAi, usage: usage ?? emptyUsage }
}
export async function getWebsiteReceptionistAdmin(organizationId: string, userId: string) { return safe(async () => { await admin(organizationId, userId); return getWebsiteReceptionistState(organizationId) }) }
/** Internal shared writer: caller authorizes and locks the Organization row first. */
export async function writeWebsiteReceptionistSettings(organizationId: string, raw: unknown, tx: Tx) {
  const { expectedUpdatedAt, acknowledged: _acknowledged, ...input } = websiteReceptionistSaveSchema.parse(raw)
  const current = await tx.websiteReceptionistConfig.findUnique({ where: { organizationId } })
  if ((current?.updatedAt.toISOString() ?? null) !== expectedUpdatedAt) fail('WEBSITE_CONFLICT', 409)
  if (input.enabled) { const ready = await readiness(organizationId, tx); if (!ready.hasSavedBusiness || !ready.hasOrganizationAi || !ready.approvedDocuments) throw new AppError('WEBSITE_NOT_READY', 'Save business details, enable organization AI, and approve published library knowledge before enabling.', 400) }
  const updatedAt = new Date(Math.max(Date.now(), (current?.updatedAt.getTime() ?? 0) + 1))
  await tx.websiteReceptionistConfig.upsert({ where: { organizationId }, create: { organizationId, ...input, updatedAt }, update: { ...input, updatedAt } })
}

export async function saveWebsiteReceptionist(organizationId: string, userId: string, raw: unknown) {
  return safe(async () => {
    await admin(organizationId, userId)
    const input = websiteReceptionistSaveSchema.parse(raw)
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR NO KEY UPDATE`
      await writeWebsiteReceptionistSettings(organizationId, input, tx)
    })
    return getWebsiteReceptionistState(organizationId)
  })
}
async function publicConfig(publicId: string, db: Tx = prisma) {
  const config = await db.websiteReceptionistConfig.findUnique({ where: { publicId: idSchema.parse(publicId) } })
  if (!config?.enabled) fail()
  return config
}
export async function getWebsiteReceptionistEmbed(publicId: string, siteOrigin: string): Promise<WebsiteEmbedData> {
  return safe(async () => { const config = await publicConfig(publicId); const origin = websiteOriginSchema.parse(siteOrigin); if (!config.allowedOrigins.includes(origin)) fail(); const ready = await readiness(config.organizationId); if (!ready.hasSavedBusiness) fail(); return { publicId, siteOrigin: origin, allowedOrigins: config.allowedOrigins, businessName: ready.businessName } })
}
function ipHash(organizationId: string, day: Date, ip: string) {
  if (!isIP(ip)) fail()
  const key = process.env.EMAIL_ENCRYPTION_KEY
  if (!key || !/^[a-f\d]{64}$/i.test(key)) fail('WEBSITE_UNAVAILABLE', 503)
  return createHmac('sha256', Buffer.from(key, 'hex')).update(`${organizationId}\n${day.toISOString()}\n${ip}`).digest('hex')
}
function contextValid(context: WebsiteRequestContext) { if (!isIP(context.ip)) fail(); try { const u = new URL(context.origin); if (!['https:', 'http:'].includes(u.protocol) || u.origin !== context.origin) fail() } catch { fail() } }
async function locked(publicId: string, db: Tx) {
  const rows = await db.$queryRaw<WebsiteReceptionistConfig[]>`SELECT * FROM "WebsiteReceptionistConfig" WHERE "publicId" = ${publicId} FOR UPDATE`
  const config = rows[0]; if (!config?.enabled) fail(); return config
}
async function usage(db: Tx, organizationId: string, day: Date, scope: string) { return db.websiteReceptionistUsage.upsert({ where: { organizationId_day_scope: { organizationId, day, scope } }, create: { organizationId, day, scope }, update: {} }) }
async function consume(db: Tx, config: WebsiteReceptionistConfig, hash: string, kind: 'sessions' | 'messages' | 'callbacks') {
  const day = dayUtc(); const scopes = ['org', `ip:${hash}`]
  const [org, ip] = await Promise.all(scopes.map(scope => usage(db, config.organizationId, day, scope)))
  const orgLimit = kind === 'sessions' ? 20 : kind === 'messages' ? config.dailyMessageLimit : config.dailyCallbackLimit
  const ipLimit = kind === 'sessions' ? 5 : kind === 'messages' ? 10 : 3
  if (org[kind] >= orgLimit || ip[kind] >= ipLimit || (kind === 'messages' && org.reservedTokens + WEBSITE_REPLY_RESERVATION > config.dailyTokenLimit)) fail('WEBSITE_LIMIT_REACHED', 429)
  for (const scope of scopes) await db.websiteReceptionistUsage.update({ where: { organizationId_day_scope: { organizationId: config.organizationId, day, scope } }, data: { [kind]: { increment: 1 }, ...(kind === 'messages' ? { reservedTokens: { increment: WEBSITE_REPLY_RESERVATION } } : {}) } })
}
export async function startWebsiteSession(publicId: string, raw: unknown, context: WebsiteRequestContext) {
  return safe(async () => {
    const input = websiteSessionInputSchema.parse(raw); idSchema.parse(publicId); contextValid(context)
    return prisma.$transaction(async db => {
      const config = await locked(publicId, db); if (!config.allowedOrigins.includes(input.siteOrigin)) fail()
      const ready = await readiness(config.organizationId, db); if (!ready.hasSavedBusiness) fail()
      const hash = ipHash(config.organizationId, dayUtc(), context.ip)
      await consume(db, config, hash, 'sessions')
      const token = randomBytes(32).toString('hex'); const expiresAt = new Date(Date.now() + 30 * 60_000)
      await db.websiteReceptionistSession.create({ data: { organizationId: config.organizationId, tokenHash: createHash('sha256').update(token).digest('hex'), ipHash: hash, siteOrigin: input.siteOrigin, configVersion: config.updatedAt, expiresAt } })
      return { token, businessName: ready.businessName, greeting: receptionistGreeting(ready.businessName), expiresAt: expiresAt.toISOString(), turn: 0 as const }
    })
  })
}
async function session(db: Tx, config: WebsiteReceptionistConfig, token: string, context: WebsiteRequestContext) {
  if (!/^[a-f\d]{64}$/.test(token)) fail()
  const found = await db.websiteReceptionistSession.findUnique({ where: { tokenHash: createHash('sha256').update(token).digest('hex') } })
  if (!found || found.organizationId !== config.organizationId || found.ipHash !== ipHash(config.organizationId, dayUtc(found.createdAt), context.ip)) fail()
  if (found.expiresAt.getTime() <= Date.now() || found.configVersion.getTime() !== config.updatedAt.getTime() || !config.allowedOrigins.includes(found.siteOrigin)) throw new AppError('WEBSITE_SESSION_EXPIRED', 'This chat expired. Start a new chat.', 410)
  if (Date.now() - found.createdAt.getTime() < 2000) fail('WEBSITE_TOO_SOON', 429)
  return found
}
export async function sendWebsiteMessage(publicId: string, token: string, raw: unknown, context: WebsiteRequestContext) {
  return safe(async () => {
    const input = websiteMessageInputSchema.parse(raw); idSchema.parse(publicId); contextValid(context)
    const claim = await prisma.$transaction(async db => {
      const config = await locked(publicId, db); const current = await session(db, config, token, context)
      if (current.lastRequestId === input.requestId && current.lastResponse) return { cached: websiteMessageResultSchema.parse(current.lastResponse) }
      if (current.inFlightId) {
        if (current.leaseExpiresAt && current.leaseExpiresAt.getTime() > Date.now()) fail('WEBSITE_PENDING', 409)
        await db.websiteReceptionistSession.update({ where: { id: current.id }, data: { closed: true, inFlightId: null, leaseExpiresAt: null } })
        return { expired: true }
      }
      if (current.closed) fail('WEBSITE_CHAT_CLOSED', 409)
      if (current.turns >= WEBSITE_SESSION_TURNS || current.turns !== input.expectedTurn) fail('WEBSITE_CONFLICT', 409)
      await consume(db, config, ipHash(config.organizationId, dayUtc(), context.ip), 'messages')
      const lease = randomUUID(); const ready = await readiness(config.organizationId, db)
      await db.websiteReceptionistSession.update({ where: { id: current.id }, data: { inFlightId: lease, leaseExpiresAt: new Date(Date.now() + 30_000) } })
      return { config, current, lease, ready }
    })
    if ('cached' in claim) return claim.cached!
    if ('expired' in claim) fail('WEBSITE_CHAT_CLOSED', 409)
    let reply = fallback; let failed = true
    if (claim.ready.hasOrganizationAi && claim.ready.hasSavedBusiness && claim.ready.approvedDocuments > 0) {
      try { const generated = await generateWebsiteReceptionistAnswer(claim.config.organizationId, claim.ready.businessName, input.question, input.history); const checked = websiteMessageResultSchema.shape.reply.safeParse(generated); if (checked.success) { reply = checked.data; failed = false } } catch { /* Provider errors are intentionally not exposed or logged. */ }
    }
    const result: WebsiteMessageResult = { reply, turn: claim.current.turns + 1, canMessage: !failed && claim.current.turns + 1 < WEBSITE_SESSION_TURNS }
    return prisma.$transaction(async db => {
      const config = await locked(publicId, db)
      if (config.updatedAt.getTime() !== claim.config.updatedAt.getTime()) throw new AppError('WEBSITE_SESSION_EXPIRED', 'This chat expired. Start a new chat.', 410)
      const done = await db.websiteReceptionistSession.updateMany({ where: { id: claim.current.id, organizationId: config.organizationId, inFlightId: claim.lease, turns: input.expectedTurn, leaseExpiresAt: { gt: new Date() }, expiresAt: { gt: new Date() } }, data: { turns: result.turn, closed: !result.canMessage, inFlightId: null, leaseExpiresAt: null, lastRequestId: input.requestId, lastResponse: result } })
      if (!done.count) {
        if (claim.current.expiresAt.getTime() <= Date.now()) throw new AppError('WEBSITE_SESSION_EXPIRED', 'This chat expired. Start a new chat.', 410)
        fail('WEBSITE_CONFLICT', 409)
      }
      return result
    })
  })
}
export async function submitWebsiteCallback(publicId: string, token: string, raw: unknown, context: WebsiteRequestContext) {
  return safe(async () => {
    const input = websiteCallbackInputSchema.parse(raw); idSchema.parse(publicId); contextValid(context)
    return prisma.$transaction(async db => {
      const config = await locked(publicId, db); const current = await session(db, config, token, context)
      if (current.callbackSubmittedAt) return { received: true as const }
      await consume(db, config, ipHash(config.organizationId, dayUtc(), context.ip), 'callbacks')
      await db.websiteReceptionistCallback.create({ data: { organizationId: config.organizationId, sourceSessionId: current.id, fullName: input.fullName, phone: input.phone, reason: input.reason, siteOrigin: current.siteOrigin } })
      await db.websiteReceptionistSession.update({ where: { id: current.id }, data: { callbackSubmittedAt: new Date() } })
      return { received: true as const }
    })
  })
}
function callbackView(row: { id: string; fullName: string; phone: string; reason: string; siteOrigin: string; status: string; consentedAt: Date; createdAt: Date; updatedAt: Date }) { return websiteCallbackRecordSchema.parse({ id: row.id, fullName: row.fullName, phone: row.phone, reason: row.reason, siteOrigin: row.siteOrigin, status: row.status, consentedAt: row.consentedAt.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }) }
export async function listWebsiteCallbacks(organizationId: string, userId: string, raw: unknown) {
  return safe(async () => { await admin(organizationId, userId); const query = websiteCallbackQuerySchema.parse(raw); const rows = await prisma.websiteReceptionistCallback.findMany({ where: { organizationId, ...(query.status === 'all' ? {} : { status: query.status }) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * 20, take: 21 }); return { callbacks: rows.slice(0, 20).map(callbackView), page: query.page, pageSize: 20 as const, hasMore: rows.length > 20 } })
}
export async function reviewWebsiteCallback(organizationId: string, userId: string, id: string, raw: unknown) {
  return safe(async () => { await admin(organizationId, userId); idSchema.parse(id); const input = websiteCallbackReviewSchema.parse(raw); return prisma.$transaction(async db => { const current = await db.websiteReceptionistCallback.findFirst({ where: { id, organizationId } }); if (!current) fail('NOT_FOUND', 404); if (current.updatedAt.toISOString() !== input.expectedUpdatedAt) fail('WEBSITE_CONFLICT', 409); const done = await db.websiteReceptionistCallback.updateMany({ where: { id, organizationId, updatedAt: current.updatedAt }, data: { status: input.action === 'review' ? 'reviewed' : 'dismissed', reviewedById: userId, updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)) } }); if (!done.count) fail('WEBSITE_CONFLICT', 409); return callbackView((await db.websiteReceptionistCallback.findFirstOrThrow({ where: { id, organizationId } }))) }) })
}
export async function deleteWebsiteCallback(organizationId: string, userId: string, id: string) { return safe(async () => { await admin(organizationId, userId); idSchema.parse(id); const done = await prisma.websiteReceptionistCallback.deleteMany({ where: { id, organizationId } }); if (!done.count) fail('NOT_FOUND', 404); return { deleted: true } }) }
export async function cleanupWebsiteReceptionist() { return safe(async () => { const cutoff = dayUtc(); cutoff.setUTCDate(cutoff.getUTCDate() - 2); const [sessions, usage] = await prisma.$transaction([prisma.websiteReceptionistSession.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } } }), prisma.websiteReceptionistUsage.deleteMany({ where: { day: { lt: cutoff } } })]); return { sessions: sessions.count, usage: usage.count } }) }
