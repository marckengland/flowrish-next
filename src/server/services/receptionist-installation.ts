import 'server-only'
import { AppError } from '@/lib/errors'
import { inspectInstallationSource, installationInputSchema, installationResultSchema } from '@/lib/receptionist-installation'
import { redis } from '@/lib/upstash/redis'
import { prisma } from '@/server/db/client'
import { callbackAccess } from './callback-access'
import { fetchInstallationPage } from './receptionist-installation-fetch'

async function current(org: string, user: string, version: string) {
  const access = await callbackAccess(org, user)
  if (!access.admin) throw new AppError('FORBIDDEN', 'Current organization administrator access is required.', 403)
  const config = await prisma.websiteReceptionistConfig.findUnique({ where: { organizationId: org }, select: { publicId: true, allowedOrigins: true, enabled: true, updatedAt: true } })
  if (!config || config.updatedAt.toISOString() !== version) throw new AppError('INSTALLATION_CHANGED', 'Saved website settings changed or are missing. Reload saved setup before checking.', 409)
  return config
}
export async function checkReceptionistInstallation(org: string, user: string, raw: unknown, appOrigin: string, signal?: AbortSignal) {
  const input = installationInputSchema.parse(raw)
  try {
    const config = await current(org, user, input.expectedUpdatedAt), originAllowed = config.allowedOrigins.includes(new URL(input.url).origin)
    const base = { requestedUrl: input.url, expectedUpdatedAt: input.expectedUpdatedAt, publicId: config.publicId, originAllowed, matchingSnippets: 0, detectedSnippets: 0 }
    if (!originAllowed) return installationResultSchema.parse({ ...base, checkedAt: new Date().toISOString(), checkedUrl: null, outcome: 'origin_not_allowed' })
    const reserved = await redis.set(`flowrish:receptionist-install:${org}`, '1', { nx: true, ex: 30 })
    if (reserved !== 'OK') throw new AppError('INSTALLATION_RATE_LIMIT', 'Wait 30 seconds before checking this organization again.', 429)
    const page = await fetchInstallationPage(input.url, config.allowedOrigins, signal)
    const fresh = await current(org, user, input.expectedUpdatedAt)
    if (fresh.publicId !== config.publicId || JSON.stringify(fresh.allowedOrigins) !== JSON.stringify(config.allowedOrigins)) throw new AppError('INSTALLATION_CHANGED', 'Saved website settings changed. Reload saved setup before checking.', 409)
    const inspected = page.outcome === 'html' ? inspectInstallationSource(page.html, config.publicId, appOrigin) : { outcome: page.outcome, matchingSnippets: 0, detectedSnippets: 0 }
    return installationResultSchema.parse({ ...base, ...inspected, checkedUrl: page.url, checkedAt: new Date().toISOString() })
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('INSTALLATION_UNAVAILABLE', 'Website installation check is unavailable. Try again later.', 503)
  }
}
