import { describe, it, expect, vi } from 'vitest'

// vi.mock is hoisted — use a hardcoded valid 64-char hex key (32 bytes)
vi.mock('@/lib/env', () => ({
  env: {
    EMAIL_ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
  },
}))

import { encrypt, decrypt } from './encryption'

describe('encryption utilities', () => {
  describe('encrypt', () => {
    it('returns a string in iv:ciphertext hex format', () => {
      const result = encrypt('hello world')
      const parts = result.split(':')

      expect(parts).toHaveLength(2)
      // IV should be 16 bytes = 32 hex chars
      expect(parts[0]).toHaveLength(32)
      // Both parts should be valid hex
      expect(parts[0]).toMatch(/^[0-9a-f]+$/)
      expect(parts[1]).toMatch(/^[0-9a-f]+$/)
    })

    it('produces different ciphertexts for the same plaintext (random IV)', () => {
      const plaintext = 'same input'
      const result1 = encrypt(plaintext)
      const result2 = encrypt(plaintext)

      expect(result1).not.toBe(result2)
    })

    it('handles empty string', () => {
      const result = encrypt('')
      const parts = result.split(':')

      expect(parts).toHaveLength(2)
      expect(parts[0]).toHaveLength(32)
    })
  })

  describe('decrypt', () => {
    it('round-trips: decrypt(encrypt(plaintext)) === plaintext', () => {
      const plaintext = 'my secret oauth token'
      const encrypted = encrypt(plaintext)
      const decrypted = decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })

    it('round-trips with special characters', () => {
      const plaintext = 'token/with+special=chars&more!@#$%'
      const encrypted = encrypt(plaintext)
      const decrypted = decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })

    it('round-trips with unicode', () => {
      const plaintext = 'token with émojis 🔑 and ñ'
      const encrypted = encrypt(plaintext)
      const decrypted = decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })

    it('round-trips with empty string', () => {
      const encrypted = encrypt('')
      const decrypted = decrypt(encrypted)

      expect(decrypted).toBe('')
    })

    it('throws on invalid format (no separator)', () => {
      expect(() => decrypt('noseparator')).toThrow('Invalid encrypted format: missing IV separator')
    })

    it('throws on invalid format (empty IV)', () => {
      expect(() => decrypt(':someciphertext')).toThrow('Invalid encrypted format: empty IV or ciphertext')
    })

    it('throws on invalid format (empty ciphertext)', () => {
      expect(() => decrypt('abcdef1234567890abcdef1234567890:')).toThrow('Invalid encrypted format: empty IV or ciphertext')
    })

    it('throws on invalid IV length', () => {
      expect(() => decrypt('abcd:abcdef1234567890')).toThrow('Invalid IV length')
    })
  })
})
