import 'server-only'
import { randomUUID } from 'node:crypto'
import { z, ZodError } from 'zod'
import type { AiProviderConfig } from '@prisma/client'
import { AI_PROVIDERS, aiProviderSettingsSchema, type AiProvider, type AiProviderSettingsView } from '@/lib/ai-provider'
import { AppError } from '@/lib/errors'
import { env } from '@/lib/env'
import { prisma } from '@/server/db/client'
import { getEffectivePermissions } from '@/server/auth/permissions'
import { decryptAiKey, encryptAiKey } from './org-ai-secret'

export interface OrganizationAiRuntime {
  organizationId: string
  version: Date
  provider: AiProvider
  baseUrl: string
  model: string
  apiKey: string
  dailyRequestLimit: number
  dailyTokenLimit: number
  maxOutputTokens: number
  maxInputBytes: number
}

export interface AiReservation {
  organizationId: string
  day: Date
  reservedTokens: number
}

function safeError(error: unknown): never {
  if (error instanceof AppError || error instanceof ZodError) throw error
  throw new AppError('AI_UNAVAILABLE', 'The organization AI settings are temporarily unavailable.', 503)
}

function conflict(): never {
  throw new AppError('AI_CONFIG_CONFLICT', 'AI settings changed. Reload the settings and try again.', 409)
}

async function requireSettingsAdmin(userId: string, organizationId: string): Promise<void> {
  const member = await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } } })
  if (!member || !(await getEffectivePermissions(userId, organizationId)).has('admin:settings')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to manage AI settings.', 403)
  }
}

function runtimeFromConfig(config: AiProviderConfig): OrganizationAiRuntime {
  if (!config.enabled) throw new AppError('AI_PAUSED', 'Organization AI is paused. Ask an administrator to enable it.', 503)
  const parsed = aiProviderSettingsSchema.safeParse({ provider: config.provider, model: config.model, enabled: config.enabled, dailyRequestLimit: config.dailyRequestLimit, dailyTokenLimit: config.dailyTokenLimit, maxOutputTokens: config.maxOutputTokens, maxInputBytes: config.maxInputBytes, expectedUpdatedAt: config.updatedAt.toISOString() })
  if (!parsed.success) throw new AppError('AI_CONFIG_INVALID', 'The organization AI settings are invalid. Ask an administrator to update them.', 503)
  const provider = parsed.data.provider
  const apiKey = decryptAiKey(config.apiKeyCiphertext, config.organizationId, provider)
  if (!apiKey || !/^[\x21-\x7e]+$/.test(apiKey)) throw new AppError('AI_CONFIG_INVALID', 'The organization AI key is invalid. Save a replacement key.', 503)
  return { organizationId: config.organizationId, version: config.updatedAt, provider, baseUrl: AI_PROVIDERS[provider].baseUrl, model: config.model, apiKey, dailyRequestLimit: config.dailyRequestLimit, dailyTokenLimit: config.dailyTokenLimit, maxOutputTokens: config.maxOutputTokens, maxInputBytes: config.maxInputBytes }
}

export async function resolveOrganizationAi(organizationId: string): Promise<OrganizationAiRuntime | null> {
  try {
    const config = await prisma.aiProviderConfig.findUnique({ where: { organizationId } })
    return config ? runtimeFromConfig(config) : null
  } catch (error) { safeError(error) }
}

export async function getAiProviderSettings(userId: string, organizationId: string): Promise<AiProviderSettingsView> {
  try {
    await requireSettingsAdmin(userId, organizationId)
    const day = new Date(new Date().toISOString().slice(0, 10))
    const [config, usage] = await Promise.all([
      prisma.aiProviderConfig.findUnique({ where: { organizationId } }),
      prisma.aiUsageDay.findUnique({ where: { organizationId_day: { organizationId, day } } }),
    ])
    return {
      config: config ? { provider: config.provider as AiProvider, model: config.model, enabled: config.enabled, hasKey: Boolean(config.apiKeyCiphertext), dailyRequestLimit: config.dailyRequestLimit, dailyTokenLimit: config.dailyTokenLimit, maxOutputTokens: config.maxOutputTokens, maxInputBytes: config.maxInputBytes, updatedAt: config.updatedAt.toISOString() } : null,
      usage: { day: day.toISOString().slice(0, 10), requests: usage?.requests ?? 0, reservedTokens: usage?.reservedTokens ?? 0, reportedTokens: usage?.reportedTokens ?? 0, completedRequests: usage?.completedRequests ?? 0, failedRequests: usage?.failedRequests ?? 0 },
      platformAvailable: Boolean(env.AI_API_KEY),
    }
  } catch (error) { safeError(error) }
}

export async function saveAiProviderSettings(userId: string, organizationId: string, input: unknown): Promise<AiProviderSettingsView> {
  try {
    await requireSettingsAdmin(userId, organizationId)
    const { expectedUpdatedAt, apiKey, ...settings } = aiProviderSettingsSchema.parse(input)
    const previous = await prisma.aiProviderConfig.findUnique({ where: { organizationId } })
    if (previous ? expectedUpdatedAt !== previous.updatedAt.toISOString() : expectedUpdatedAt !== null) conflict()
    if (!apiKey && (!previous || previous.provider !== settings.provider)) {
      throw new AppError('AI_KEY_REQUIRED', 'Enter a new API key when choosing a provider.', 400)
    }
    const apiKeyCiphertext = apiKey ? encryptAiKey(apiKey, organizationId, settings.provider) : previous!.apiKeyCiphertext
    if (previous) {
      // A strictly increasing timestamp also invalidates requests saved within the same millisecond.
      const updatedAt = new Date(Math.max(Date.now(), previous.updatedAt.getTime() + 1))
      const result = await prisma.aiProviderConfig.updateMany({ where: { organizationId, updatedAt: previous.updatedAt }, data: { ...settings, apiKeyCiphertext, updatedAt } })
      if (result.count !== 1) conflict()
    } else {
      try { await prisma.aiProviderConfig.create({ data: { organizationId, ...settings, apiKeyCiphertext } }) }
      catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') conflict(); throw error }
    }
    return await getAiProviderSettings(userId, organizationId)
  } catch (error) { safeError(error) }
}

export async function reserveAiUsage(runtime: OrganizationAiRuntime, inputBytes: number, outputTokens: number): Promise<AiReservation> {
  if (!Number.isSafeInteger(inputBytes) || inputBytes < 0 || inputBytes > runtime.maxInputBytes) throw new AppError('AI_INPUT_TOO_LARGE', 'This AI request exceeds the organization input limit.', 413)
  if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > runtime.maxOutputTokens) throw new AppError('AI_OUTPUT_TOO_LARGE', 'This AI request exceeds the organization output limit.', 400)
  const reservedTokens = inputBytes + 256 + outputTokens
  try {
    const result = await prisma.$queryRaw<Array<{ day: Date }>>`
      WITH current_config AS (
        SELECT "dailyRequestLimit", "dailyTokenLimit" FROM "AiProviderConfig"
        WHERE "organizationId" = ${runtime.organizationId} AND "updatedAt" = ${runtime.version} AND "enabled" = true
        FOR SHARE
      )
      INSERT INTO "AiUsageDay" ("id", "organizationId", "day", "requests", "reservedTokens", "reportedTokens", "completedRequests", "failedRequests", "createdAt", "updatedAt")
      SELECT ${randomUUID()}, ${runtime.organizationId}, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, 1, ${reservedTokens}, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM current_config WHERE ${reservedTokens} <= "dailyTokenLimit" AND "dailyRequestLimit" >= 1
      ON CONFLICT ("organizationId", "day") DO UPDATE
      SET "requests" = "AiUsageDay"."requests" + 1, "reservedTokens" = "AiUsageDay"."reservedTokens" + ${reservedTokens}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "AiUsageDay"."requests" < (SELECT "dailyRequestLimit" FROM current_config)
        AND "AiUsageDay"."reservedTokens" + ${reservedTokens} <= (SELECT "dailyTokenLimit" FROM current_config)
      RETURNING "day"
    `
    if (result.length !== 1) throw new AppError('AI_LIMIT_REACHED', 'The organization AI limit was reached or its settings changed. Try again after reviewing AI settings.', 429)
    return { organizationId: runtime.organizationId, day: result[0].day, reservedTokens }
  } catch (error) { safeError(error) }
}

export async function finishAiUsage(reservation: AiReservation, result: { success: boolean; totalTokens?: number }): Promise<void> {
  const totalTokens = typeof result.totalTokens === 'number' && Number.isSafeInteger(result.totalTokens) && result.totalTokens >= 0 && result.totalTokens <= 2147483647 ? result.totalTokens : 0
  const extraTokens = Math.max(0, totalTokens - reservation.reservedTokens)
  try {
    await prisma.$executeRaw`
      UPDATE "AiUsageDay" SET "completedRequests" = "completedRequests" + ${result.success ? 1 : 0},
        "failedRequests" = "failedRequests" + ${result.success ? 0 : 1}, "reportedTokens" = "reportedTokens" + ${totalTokens},
        "reservedTokens" = "reservedTokens" + ${extraTokens}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "organizationId" = ${reservation.organizationId} AND "day" = ${reservation.day}::date
    `
  } catch (error) { safeError(error) }
}

async function boundedProbeBody(response: Response): Promise<unknown> {
  if (!response.body) throw new Error()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > 16384) throw new Error()
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { await reader.cancel().catch(() => {}) }
}

export async function testAiProviderSettings(userId: string, organizationId: string, expectedUpdatedAt: string): Promise<{ ok: true }> {
  try {
    await requireSettingsAdmin(userId, organizationId)
    z.string().datetime().parse(expectedUpdatedAt)
    const config = await prisma.aiProviderConfig.findUnique({ where: { organizationId } })
    if (!config || config.updatedAt.toISOString() !== expectedUpdatedAt) conflict()
    const runtime = runtimeFromConfig(config)
    const messages = [{ role: 'user', content: 'Reply OK.' }]
    const outputTokens = runtime.provider === 'gemini' ? Math.min(runtime.maxOutputTokens, 2048) : 32
    const reservation = await reserveAiUsage(runtime, Buffer.byteLength(JSON.stringify(messages), 'utf8'), outputTokens)
    let success = false
    let totalTokens: number | undefined
    try {
      const response = await fetch(`${runtime.baseUrl}/chat/completions`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${runtime.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: runtime.model, messages, max_tokens: outputTokens, ...(runtime.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}), ...(runtime.provider === 'gemini' ? { reasoning_effort: 'low' } : {}) }) })
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error() }
      const data = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) })).min(1), usage: z.object({ total_tokens: z.number().int().nonnegative().max(10000000).optional() }).optional() }).parse(await boundedProbeBody(response))
      totalTokens = data.usage?.total_tokens
      success = true
      return { ok: true }
    } catch {
      throw new AppError('AI_CONNECTION_FAILED', 'The AI connection test failed. Check the provider, model, API key and provider quota.', 502)
    } finally { await finishAiUsage(reservation, { success, totalTokens }) }
  } catch (error) { safeError(error) }
}
