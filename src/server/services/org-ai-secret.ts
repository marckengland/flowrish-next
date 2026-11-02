import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '@/lib/env'
import type { AiProvider } from '@/lib/ai-provider'
import { AppError } from '@/lib/errors'

function aad(organizationId: string, provider: AiProvider): Buffer {
  return Buffer.from(JSON.stringify(['organization-ai-key', 1, organizationId, provider]))
}

export function encryptAiKey(apiKey: string, organizationId: string, provider: AiProvider): string {
  try {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(env.EMAIL_ENCRYPTION_KEY, 'hex'), iv)
    cipher.setAAD(aad(organizationId, provider))
    const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])
    return ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), ciphertext.toString('hex')].join(':')
  } catch {
    throw new AppError('AI_CONFIG_INVALID', 'The organization AI credentials could not be secured.', 503)
  }
}

export function decryptAiKey(value: string, organizationId: string, provider: AiProvider): string {
  try {
    const parts = value.split(':')
    if (parts.length !== 4 || parts[0] !== 'v1' || !/^[a-f0-9]{24}$/.test(parts[1]) || !/^[a-f0-9]{32}$/.test(parts[2]) || !/^(?:[a-f0-9]{2})+$/.test(parts[3])) throw new Error()
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(env.EMAIL_ENCRYPTION_KEY, 'hex'), Buffer.from(parts[1], 'hex'))
    decipher.setAAD(aad(organizationId, provider))
    decipher.setAuthTag(Buffer.from(parts[2], 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'hex')), decipher.final()]).toString('utf8')
  } catch {
    throw new AppError('AI_CONFIG_INVALID', 'The organization AI credentials could not be read. Save a replacement key.', 503)
  }
}
