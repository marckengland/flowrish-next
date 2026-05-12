import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { env } from '@/lib/env'

const ALGORITHM = 'aes-256-cbc'
const IV_LENGTH = 16 // AES block size in bytes

/**
 * Derives the encryption key Buffer from the validated hex string in env.
 * EMAIL_ENCRYPTION_KEY is guaranteed to be 64 hex chars (32 bytes) by env validation.
 */
function getKey(): Buffer {
  return Buffer.from(env.EMAIL_ENCRYPTION_KEY, 'hex')
}

/**
 * Encrypts a plaintext string using AES-256-CBC with a random IV.
 * Returns the result as `iv:ciphertext` where both parts are hex-encoded.
 *
 * @param plaintext - The string to encrypt
 * @returns Encrypted string in format `iv:ciphertext` (hex-encoded)
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])

  return `${iv.toString('hex')}:${encrypted.toString('hex')}`
}

/**
 * Decrypts a string that was encrypted with the `encrypt` function.
 * Expects input in `iv:ciphertext` hex format.
 *
 * @param encrypted - The encrypted string in format `iv:ciphertext` (hex-encoded)
 * @returns The original plaintext string
 * @throws Error if the format is invalid or decryption fails
 */
export function decrypt(encrypted: string): string {
  const separatorIndex = encrypted.indexOf(':')
  if (separatorIndex === -1) {
    throw new Error('Invalid encrypted format: missing IV separator')
  }

  const ivHex = encrypted.slice(0, separatorIndex)
  const ciphertextHex = encrypted.slice(separatorIndex + 1)

  if (!ivHex || !ciphertextHex) {
    throw new Error('Invalid encrypted format: empty IV or ciphertext')
  }

  const iv = Buffer.from(ivHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH} bytes, got ${iv.length}`)
  }

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv)

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}
