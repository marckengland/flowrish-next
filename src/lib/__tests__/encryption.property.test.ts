import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'

// Mock env with a valid 64-char hex key (32 bytes for AES-256)
vi.mock('@/lib/env', () => ({
  env: {
    EMAIL_ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
  },
}))

import { encrypt, decrypt } from '@/lib/encryption'

describe('encryption - property tests', () => {
  /**
   * **Validates: Requirements 7.1**
   *
   * Property: Encrypting then decrypting any string returns the original value.
   * This ensures the round-trip invariant holds for arbitrary inputs including
   * unicode, special characters, and empty strings.
   */
  it('encrypt then decrypt always returns the original plaintext', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 1000 }),
        (plaintext) => {
          const encrypted = encrypt(plaintext)
          const decrypted = decrypt(encrypted)
          expect(decrypted).toBe(plaintext)
        }
      ),
      { numRuns: 200 }
    )
  })

  /**
   * **Validates: Requirements 7.1**
   *
   * Property: Encrypting then decrypting unicode strings (including emoji,
   * multi-byte characters, and special chars) returns the original value.
   */
  it('encrypt then decrypt preserves unicode and special characters', () => {
    fc.assert(
      fc.property(
        fc.unicodeString({ minLength: 0, maxLength: 500 }),
        (plaintext) => {
          const encrypted = encrypt(plaintext)
          const decrypted = decrypt(encrypted)
          expect(decrypted).toBe(plaintext)
        }
      ),
      { numRuns: 200 }
    )
  })

  /**
   * **Validates: Requirements 7.1**
   *
   * Property: Two encryptions of the same plaintext produce different ciphertexts.
   * This confirms a random IV is used for each encryption, preventing identical
   * ciphertexts that would leak information about repeated plaintexts.
   */
  it('two encryptions of the same plaintext produce different ciphertexts (random IV)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        (plaintext) => {
          const encrypted1 = encrypt(plaintext)
          const encrypted2 = encrypt(plaintext)
          expect(encrypted1).not.toBe(encrypted2)
        }
      ),
      { numRuns: 200 }
    )
  })
})
