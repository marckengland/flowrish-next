import { prisma } from '@/server/db/client'
import { encrypt, decrypt } from '@/lib/encryption'
import { AppError } from '@/lib/errors'

/**
 * Voice / calling configuration service (bring-your-own credentials).
 *
 * Each organization stores its OWN provider credentials — Flowrish never
 * ships shared telephony keys. Secrets (the Twilio API Key Secret) are
 * encrypted at rest with the same AES helper used for email tokens.
 */

/** Non-secret view returned to the client — the API secret is never sent back. */
export interface VoiceConfigView {
  configured: boolean
  provider: string
  twilioAccountSid: string | null
  twilioApiKeySid: string | null
  twilioTwimlAppSid: string | null
  twilioCallerId: string | null
  /** Whether an API secret is stored (so the UI can show "saved" without revealing it). */
  hasApiKeySecret: boolean
}

/** Fully-decrypted Twilio credentials for server-side token minting. */
export interface TwilioCredentials {
  accountSid: string
  apiKeySid: string
  apiKeySecret: string
  twimlAppSid: string
  callerId: string
}

export interface SaveTwilioConfigInput {
  twilioAccountSid: string
  twilioApiKeySid: string
  /** Optional on update — when blank/omitted the existing secret is kept. */
  twilioApiKeySecret?: string
  twilioTwimlAppSid: string
  twilioCallerId: string
}

/**
 * Returns the org's voice config with the API secret masked. Safe to send
 * to the client / admin UI.
 */
export async function getVoiceConfigView(orgId: string): Promise<VoiceConfigView> {
  const config = await prisma.voiceConfig.findUnique({
    where: { organizationId: orgId },
  })

  if (!config) {
    return {
      configured: false,
      provider: 'twilio',
      twilioAccountSid: null,
      twilioApiKeySid: null,
      twilioTwimlAppSid: null,
      twilioCallerId: null,
      hasApiKeySecret: false,
    }
  }

  const complete = Boolean(
    config.twilioAccountSid &&
      config.twilioApiKeySid &&
      config.twilioApiKeySecret &&
      config.twilioTwimlAppSid &&
      config.twilioCallerId,
  )

  return {
    configured: complete,
    provider: config.provider,
    twilioAccountSid: config.twilioAccountSid,
    twilioApiKeySid: config.twilioApiKeySid,
    twilioTwimlAppSid: config.twilioTwimlAppSid,
    twilioCallerId: config.twilioCallerId,
    hasApiKeySecret: Boolean(config.twilioApiKeySecret),
  }
}

/**
 * Upserts the org's Twilio credentials. When `twilioApiKeySecret` is blank
 * and a secret already exists, the existing (encrypted) secret is retained
 * so admins can edit other fields without re-entering the secret.
 */
export async function saveTwilioConfig(
  orgId: string,
  input: SaveTwilioConfigInput,
): Promise<VoiceConfigView> {
  const accountSid = input.twilioAccountSid.trim()
  const apiKeySid = input.twilioApiKeySid.trim()
  const twimlAppSid = input.twilioTwimlAppSid.trim()
  const callerId = input.twilioCallerId.trim()
  const newSecret = input.twilioApiKeySecret?.trim() ?? ''

  if (!accountSid || !apiKeySid || !twimlAppSid || !callerId) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Account SID, API Key SID, TwiML App SID and Caller ID are all required.',
      400,
    )
  }
  if (!/^\+?[0-9]{6,16}$/.test(callerId.replace(/[\s()-]/g, ''))) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Caller ID must be a phone number in E.164 format (e.g. +14155551234).',
      400,
    )
  }

  const existing = await prisma.voiceConfig.findUnique({
    where: { organizationId: orgId },
  })

  let encryptedSecret: string | null
  if (newSecret) {
    encryptedSecret = encrypt(newSecret)
  } else if (existing?.twilioApiKeySecret) {
    encryptedSecret = existing.twilioApiKeySecret
  } else {
    throw new AppError(
      'VALIDATION_ERROR',
      'API Key Secret is required the first time you connect.',
      400,
    )
  }

  await prisma.voiceConfig.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      provider: 'twilio',
      twilioAccountSid: accountSid,
      twilioApiKeySid: apiKeySid,
      twilioApiKeySecret: encryptedSecret,
      twilioTwimlAppSid: twimlAppSid,
      twilioCallerId: callerId,
    },
    update: {
      provider: 'twilio',
      twilioAccountSid: accountSid,
      twilioApiKeySid: apiKeySid,
      twilioApiKeySecret: encryptedSecret,
      twilioTwimlAppSid: twimlAppSid,
      twilioCallerId: callerId,
    },
  })

  return getVoiceConfigView(orgId)
}

/** Removes the org's stored voice credentials. */
export async function deleteVoiceConfig(orgId: string): Promise<void> {
  await prisma.voiceConfig
    .delete({ where: { organizationId: orgId } })
    .catch(() => {
      // Already absent — treat delete as idempotent.
    })
}

/**
 * Returns fully-decrypted Twilio credentials for the org, or null when the
 * org hasn't configured a complete set. Server-only (used to mint tokens).
 */
export async function getTwilioCredentials(
  orgId: string,
): Promise<TwilioCredentials | null> {
  const config = await prisma.voiceConfig.findUnique({
    where: { organizationId: orgId },
  })
  if (
    !config ||
    !config.twilioAccountSid ||
    !config.twilioApiKeySid ||
    !config.twilioApiKeySecret ||
    !config.twilioTwimlAppSid ||
    !config.twilioCallerId
  ) {
    return null
  }

  let apiKeySecret: string
  try {
    apiKeySecret = decrypt(config.twilioApiKeySecret)
  } catch {
    return null
  }

  return {
    accountSid: config.twilioAccountSid,
    apiKeySid: config.twilioApiKeySid,
    apiKeySecret,
    twimlAppSid: config.twilioTwimlAppSid,
    callerId: config.twilioCallerId,
  }
}

/**
 * Returns just the org's Twilio caller ID (used by the unauthenticated
 * TwiML webhook, which only needs the number to dial from).
 */
export async function getTwilioCallerId(orgId: string): Promise<string | null> {
  const config = await prisma.voiceConfig.findUnique({
    where: { organizationId: orgId },
    select: { twilioCallerId: true },
  })
  return config?.twilioCallerId ?? null
}
