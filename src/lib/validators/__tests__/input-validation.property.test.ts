import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  sanitizedString,
  safeFileName,
  safeJsonBody,
  hasPrototypePollution,
} from '@/lib/validators/common'

/**
 * Property-based tests for input validation schemas.
 * **Validates: Requirements 21.4, 21.5, 21.6**
 */
describe('Input Validation Schemas - Property Tests', () => {
  describe('Property: Sanitized strings strip null bytes and allow ordinary prose', () => {
    /**
     * **Validates: Requirements 21.4, 21.5**
     */
    it('strips null bytes from any string input', () => {
      fc.assert(
        fc.property(
          fc.string().map(s => s.slice(0, 100)), // Keep strings reasonable length
          (baseStr) => {
            // Inject null bytes at random positions
            const withNullBytes = baseStr + '\0' + baseStr + '\0'
            const result = sanitizedString.safeParse(withNullBytes)

            if (result.success) {
              // If parsing succeeds, the output must not contain null bytes
              expect(result.data).not.toContain('\0')
            }
          }
        )
      )
    })

    it('accepts free text containing dot sequences (ellipses / "..")', () => {
      // Regression guard: these are prose fields, not paths. Text with
      // ".."/"..." must be accepted (only length + null-byte rules apply).
      fc.assert(
        fc.property(
          fc.string().map(s => s.slice(0, 100).replace(/\0/g, '')),
          fc.string().map(s => s.slice(0, 100).replace(/\0/g, '')),
          (prefix, suffix) => {
            const text = `${prefix}..${suffix}`
            const result = sanitizedString.safeParse(text)
            expect(result.success).toBe(true)
            if (result.success) expect(result.data).toBe(text)
          }
        )
      )
    })

    it('safeFileName always rejects traversal sequences and separators', () => {
      // Path-traversal protection lives here (the upload boundary), not in
      // the general text validators.
      fc.assert(
        fc.property(
          fc.string().map(s => s.slice(0, 50).replace(/\0/g, '')),
          fc.string().map(s => s.slice(0, 50).replace(/\0/g, '')),
          (prefix, suffix) => {
            expect(safeFileName.safeParse(`${prefix}..${suffix}`).success).toBe(false)
            expect(safeFileName.safeParse(`${prefix}/${suffix}`).success).toBe(false)
          }
        )
      )
    })

    it('successful parse never contains null bytes regardless of input', () => {
      fc.assert(
        fc.property(
          // Generate strings that may contain null bytes but no path traversal
          fc.stringOf(
            fc.oneof(
              fc.char(),
              fc.constant('\0')
            )
          ).filter(s => !s.includes('..') && s.length <= 10000),
          (input) => {
            const result = sanitizedString.safeParse(input)

            if (result.success) {
              expect(result.data).not.toContain('\0')
            }
          }
        )
      )
    })

    it('accepts valid strings without null bytes or path traversal', () => {
      fc.assert(
        fc.property(
          // Generate safe strings: no null bytes, no "..", reasonable length
          fc.stringOf(
            fc.char().filter(c => c !== '\0' && c !== '.')
          ).filter(s => s.length <= 10000),
          (safeStr) => {
            const result = sanitizedString.safeParse(safeStr)
            expect(result.success).toBe(true)
            if (result.success) {
              expect(result.data).toBe(safeStr)
            }
          }
        )
      )
    })
  })

  describe('Property: Prototype pollution keys are always rejected', () => {
    /**
     * **Validates: Requirements 21.6**
     */
    const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'] as const

    it('rejects objects with top-level prototype pollution keys', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...DANGEROUS_KEYS),
          fc.jsonValue(),
          (dangerousKey, value) => {
            const maliciousObj = { [dangerousKey]: value, safe: 'data' }
            const result = safeJsonBody.safeParse(maliciousObj)

            expect(result.success).toBe(false)
          }
        )
      )
    })

    it('rejects objects with nested prototype pollution keys', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...DANGEROUS_KEYS),
          fc.jsonValue(),
          (dangerousKey, value) => {
            const maliciousObj = {
              level1: {
                level2: {
                  [dangerousKey]: value,
                },
              },
            }
            const result = safeJsonBody.safeParse(maliciousObj)

            expect(result.success).toBe(false)
          }
        )
      )
    })

    it('hasPrototypePollution detects dangerous keys at any depth', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...DANGEROUS_KEYS),
          fc.nat({ max: 5 }),
          fc.jsonValue(),
          (dangerousKey, depth, value) => {
            // Build a nested object with the dangerous key at the specified depth
            let obj: Record<string, unknown> = { [dangerousKey]: value }
            for (let i = 0; i < depth; i++) {
              obj = { [`level${i}`]: obj }
            }

            expect(hasPrototypePollution(obj)).toBe(true)
          }
        )
      )
    })

    it('accepts objects without prototype pollution keys', () => {
      fc.assert(
        fc.property(
          fc.dictionary(
            // Generate safe keys that are not dangerous
            fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,20}$/).filter(
              k => !DANGEROUS_KEYS.includes(k as typeof DANGEROUS_KEYS[number])
            ),
            fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null))
          ),
          (safeObj) => {
            const result = safeJsonBody.safeParse(safeObj)
            // Should succeed since no dangerous keys are present
            expect(result.success).toBe(true)
          }
        )
      )
    })

    it('hasPrototypePollution returns false for safe objects', () => {
      fc.assert(
        fc.property(
          fc.dictionary(
            fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,20}$/).filter(
              k => !DANGEROUS_KEYS.includes(k as typeof DANGEROUS_KEYS[number])
            ),
            fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null))
          ),
          (safeObj) => {
            expect(hasPrototypePollution(safeObj)).toBe(false)
          }
        )
      )
    })
  })
})
