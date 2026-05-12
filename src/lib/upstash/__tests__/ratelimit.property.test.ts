import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Property-based tests for rate limiting logic.
 * **Validates: Requirements 15.1, 15.4, 15.5**
 *
 * Since we can't hit real Redis in tests, we mock the Redis client
 * and verify the logical behavior of the brute-force protection functions.
 */

// In-memory store that simulates Redis behavior
let store: Map<string, string | number>

function resetStore() {
  store = new Map()
}

// Mock the redis module before importing the rate limiting functions
vi.mock('@/lib/upstash/redis', () => {
  return {
    redis: {
      incr: async (key: string) => {
        const current = store.get(key)
        const newVal = typeof current === 'number' ? current + 1 : 1
        store.set(key, newVal)
        return newVal
      },
      expire: async (_key: string, _seconds: number) => {
        // In our mock, we don't actually expire — tests run synchronously
        return 1
      },
      set: async (key: string, value: string, _opts?: { ex?: number }) => {
        store.set(key, value)
        return 'OK'
      },
      get: async (key: string) => {
        return store.has(key) ? store.get(key) : null
      },
      del: async (...keys: string[]) => {
        let count = 0
        for (const key of keys) {
          if (store.has(key)) {
            store.delete(key)
            count++
          }
        }
        return count
      },
    },
  }
})

// Import after mocking
import { recordLoginFailure, isLoginLockedOut, clearLoginFailures } from '@/lib/upstash/ratelimit'

// Arbitrary generators for IPs and emails
const arbIp = fc.tuple(
  fc.integer({ min: 1, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 })
).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`)

const arbEmail = fc.tuple(
  fc.stringMatching(/^[a-z]{3,10}$/),
  fc.stringMatching(/^[a-z]{3,8}$/),
  fc.constantFrom('com', 'org', 'net', 'io')
).map(([user, domain, tld]) => `${user}@${domain}.${tld}`)

describe('Rate Limiting Logic - Property Tests', () => {
  beforeEach(() => {
    resetStore()
  })

  describe('Property: Request count never exceeds configured limit within sliding window', () => {
    /**
     * **Validates: Requirements 15.1**
     *
     * After N failures (N < 5), recordLoginFailure returns false (not locked).
     * After exactly 5 failures, recordLoginFailure returns true (locked).
     * The counter never allows more than 5 failures without triggering lockout.
     */
    it('after N < 5 failures, recordLoginFailure returns false (not locked)', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbIp,
          arbEmail,
          fc.integer({ min: 1, max: 4 }),
          async (ip, email, failureCount) => {
            resetStore()

            let lastResult = false
            for (let i = 0; i < failureCount; i++) {
              lastResult = await recordLoginFailure(ip, email)
            }

            // With fewer than 5 failures, should not be locked out
            expect(lastResult).toBe(false)
          }
        )
      )
    })

    it('after exactly 5 failures, recordLoginFailure returns true (locked out)', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbIp,
          arbEmail,
          async (ip, email) => {
            resetStore()

            let result = false
            for (let i = 0; i < 5; i++) {
              result = await recordLoginFailure(ip, email)
            }

            // After exactly 5 failures, must be locked out
            expect(result).toBe(true)
          }
        )
      )
    })

    it('lockout threshold is exactly 5 — the 5th attempt triggers lockout', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbIp,
          arbEmail,
          async (ip, email) => {
            resetStore()

            const results: boolean[] = []
            for (let i = 0; i < 5; i++) {
              results.push(await recordLoginFailure(ip, email))
            }

            // First 4 attempts should return false
            expect(results.slice(0, 4).every(r => r === false)).toBe(true)
            // 5th attempt should return true
            expect(results[4]).toBe(true)
          }
        )
      )
    })
  })

  describe('Property: Successful login always resets brute-force counter to zero', () => {
    /**
     * **Validates: Requirements 15.5**
     *
     * After clearLoginFailures is called, isLoginLockedOut returns false
     * and subsequent failures start counting from zero again.
     */
    it('after clearLoginFailures, isLoginLockedOut returns false', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbIp,
          arbEmail,
          fc.integer({ min: 1, max: 5 }),
          async (ip, email, failureCount) => {
            resetStore()

            // Record some failures
            for (let i = 0; i < failureCount; i++) {
              await recordLoginFailure(ip, email)
            }

            // Clear failures (simulating successful login)
            await clearLoginFailures(ip, email)

            // Should no longer be locked out
            const lockedOut = await isLoginLockedOut(ip, email)
            expect(lockedOut).toBe(false)
          }
        )
      )
    })

    it('after clearLoginFailures, counter resets — need 5 more failures to lock again', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbIp,
          arbEmail,
          fc.integer({ min: 1, max: 4 }),
          async (ip, email, initialFailures) => {
            resetStore()

            // Record some failures (less than 5)
            for (let i = 0; i < initialFailures; i++) {
              await recordLoginFailure(ip, email)
            }

            // Clear (successful login)
            await clearLoginFailures(ip, email)

            // Record fewer than 5 new failures — should NOT be locked
            for (let i = 0; i < 4; i++) {
              await recordLoginFailure(ip, email)
            }

            const lockedOut = await isLoginLockedOut(ip, email)
            expect(lockedOut).toBe(false)
          }
        )
      )
    })

    it('clearLoginFailures removes both attempt counter and lockout key', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbIp,
          arbEmail,
          async (ip, email) => {
            resetStore()

            // Trigger lockout
            for (let i = 0; i < 5; i++) {
              await recordLoginFailure(ip, email)
            }

            // Verify locked
            expect(await isLoginLockedOut(ip, email)).toBe(true)

            // Clear
            await clearLoginFailures(ip, email)

            // Both keys should be gone
            expect(await isLoginLockedOut(ip, email)).toBe(false)

            // Counter should be reset — 1 failure should not lock
            const result = await recordLoginFailure(ip, email)
            expect(result).toBe(false)
          }
        )
      )
    })
  })

  describe('Property: Lockout persists for full duration regardless of subsequent attempts', () => {
    /**
     * **Validates: Requirements 15.4**
     *
     * Once locked out, isLoginLockedOut returns true regardless of
     * how many additional attempts are made (until explicitly cleared).
     */
    it('after lockout, isLoginLockedOut returns true regardless of additional attempts', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbIp,
          arbEmail,
          fc.integer({ min: 1, max: 10 }),
          async (ip, email, additionalAttempts) => {
            resetStore()

            // Trigger lockout with 5 failures
            for (let i = 0; i < 5; i++) {
              await recordLoginFailure(ip, email)
            }

            // Make additional attempts (simulating someone still trying)
            for (let i = 0; i < additionalAttempts; i++) {
              await recordLoginFailure(ip, email)
            }

            // Should still be locked out
            const lockedOut = await isLoginLockedOut(ip, email)
            expect(lockedOut).toBe(true)
          }
        )
      )
    })

    it('lockout is per IP+email combination — different combos are independent', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbIp,
          arbEmail,
          arbIp,
          arbEmail,
          async (ip1, email1, ip2, email2) => {
            // Skip if both combos are the same
            if (ip1 === ip2 && email1.toLowerCase() === email2.toLowerCase()) return

            resetStore()

            // Only lock out ip1+email1
            for (let i = 0; i < 5; i++) {
              await recordLoginFailure(ip1, email1)
            }

            // ip1+email1 should be locked
            expect(await isLoginLockedOut(ip1, email1)).toBe(true)

            // Different IP or email should NOT be locked
            expect(await isLoginLockedOut(ip2, email2)).toBe(false)
          }
        )
      )
    })

    it('multiple checks of lockout status do not change the lockout state', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbIp,
          arbEmail,
          fc.integer({ min: 2, max: 10 }),
          async (ip, email, checkCount) => {
            resetStore()

            // Trigger lockout
            for (let i = 0; i < 5; i++) {
              await recordLoginFailure(ip, email)
            }

            // Check lockout status multiple times
            const results: boolean[] = []
            for (let i = 0; i < checkCount; i++) {
              results.push(await isLoginLockedOut(ip, email))
            }

            // All checks should return true (checking doesn't consume the lockout)
            expect(results.every(r => r === true)).toBe(true)
          }
        )
      )
    })
  })
})
