import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Property-based tests for email personalization and token refresh.
 *
 * These tests verify that:
 * 1. All personalization tags in a sent email are replaced (no raw {{Tag}} in output)
 * 2. Token refresh with a still-valid token does not change the stored token (idempotence)
 *
 * **Validates: Requirements 7.2, 7.5**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  emailAccount: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['EmailAccount'],
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

vi.mock('@/lib/encryption', () => ({
  encrypt: vi.fn((val: string) => `encrypted:${val}`),
  decrypt: vi.fn((val: string) => val.replace('encrypted:', '')),
}))

vi.mock('@/lib/env', () => ({
  env: {
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    EMAIL_ENCRYPTION_KEY: 'a'.repeat(64),
  },
}))

// Mock global fetch for the token refresh test
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { replacePersonalizationTags, refreshTokenIfNeeded } from '@/server/services/email'

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid UUID */
const uuidArb = fc.uuid()

/** Generate a non-empty string for lead fields */
const nameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('{{') && !s.includes('}}'))

/** Generate a nullable string for optional lead fields */
const nullableNameArb = fc.oneof(fc.constant(null), nameArb)

/** Generate a lead object for personalization */
const leadArb = fc.record({
  firstName: fc.string({ minLength: 0, maxLength: 50 }),
  lastName: fc.string({ minLength: 0, maxLength: 50 }),
  companyName: fc.oneof(fc.constant(null), fc.string({ minLength: 0, maxLength: 50 })),
  title: fc.oneof(fc.constant(null), fc.string({ minLength: 0, maxLength: 50 })),
})

/** All supported personalization tags */
const TAGS = ['{{FirstName}}', '{{LastName}}', '{{FullName}}', '{{CompanyName}}', '{{Title}}']

/** Generate a tag from the supported set */
const tagArb = fc.constantFrom(...TAGS)

/**
 * Generate an email template that contains at least one personalization tag.
 * Mixes random text with tags to create realistic templates.
 */
const templateWithTagsArb = fc
  .tuple(
    fc.array(
      fc.oneof(
        // Plain text segments (no curly braces to avoid accidental tag-like patterns)
        fc.string({ minLength: 0, maxLength: 30 }).filter(s => !s.includes('{{') && !s.includes('}}')),
        // Personalization tags
        tagArb,
      ),
      { minLength: 2, maxLength: 10 },
    ),
  )
  .filter(([parts]) => parts.some(p => TAGS.includes(p)))
  .map(([parts]) => parts.join(' '))

/**
 * Generate a template that may or may not contain tags.
 * Includes edge cases like multiple occurrences of the same tag.
 */
const templateArb = fc.oneof(
  templateWithTagsArb,
  // Template with repeated tags
  fc.tuple(tagArb, fc.nat({ max: 5 })).map(([tag, count]) =>
    Array(count + 1).fill(`Hello ${tag}`).join(', '),
  ),
  // Template with all tags
  fc.constant(`Hi {{FirstName}} {{LastName}}, your title is {{Title}} at {{CompanyName}}. Full: {{FullName}}`),
)

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Email Personalization - Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Property: All personalization tags in a sent email are replaced (no raw {{Tag}} in output)', () => {
    /**
     * **Validates: Requirements 7.2**
     *
     * After replacePersonalizationTags is called, the output must not contain
     * any of the supported personalization tags ({{FirstName}}, {{LastName}},
     * {{FullName}}, {{CompanyName}}, {{Title}}). Tags are replaced with the
     * corresponding lead field value (or empty string if null).
     */

    it('no supported personalization tags remain in output after replacement', () => {
      fc.assert(
        fc.property(
          templateArb,
          leadArb,
          (template, lead) => {
            const result = replacePersonalizationTags(template, lead)

            // No supported tag should remain in the output
            for (const tag of TAGS) {
              expect(result).not.toContain(tag)
            }
          },
        ),
      )
    })

    it('output never contains any {{...}} pattern matching supported tags', () => {
      fc.assert(
        fc.property(
          templateWithTagsArb,
          leadArb,
          (template, lead) => {
            const result = replacePersonalizationTags(template, lead)

            // Verify no supported tag pattern remains
            const tagPattern = /\{\{(FirstName|LastName|FullName|CompanyName|Title)\}\}/g
            expect(result).not.toMatch(tagPattern)
          },
        ),
      )
    })

    it('tags are replaced with correct lead field values', () => {
      fc.assert(
        fc.property(
          leadArb,
          (lead) => {
            // Test each tag individually to verify correct substitution
            expect(replacePersonalizationTags('{{FirstName}}', lead)).toBe(lead.firstName)
            expect(replacePersonalizationTags('{{LastName}}', lead)).toBe(lead.lastName)
            expect(replacePersonalizationTags('{{FullName}}', lead)).toBe(
              [lead.firstName, lead.lastName].filter(Boolean).join(' '),
            )
            expect(replacePersonalizationTags('{{CompanyName}}', lead)).toBe(lead.companyName ?? '')
            expect(replacePersonalizationTags('{{Title}}', lead)).toBe(lead.title ?? '')
          },
        ),
      )
    })

    it('multiple occurrences of the same tag are all replaced', () => {
      fc.assert(
        fc.property(
          tagArb,
          fc.nat({ max: 10 }),
          leadArb,
          (tag, repeatCount, lead) => {
            const template = Array(repeatCount + 1).fill(tag).join(' ')
            const result = replacePersonalizationTags(template, lead)

            expect(result).not.toContain(tag)
          },
        ),
      )
    })

    it('text without tags is unchanged after replacement', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 200 }).filter(s => !TAGS.some(t => s.includes(t))),
          leadArb,
          (plainText, lead) => {
            const result = replacePersonalizationTags(plainText, lead)
            expect(result).toBe(plainText)
          },
        ),
      )
    })
  })

  describe('Property: Token refresh with still-valid token does not change stored token (idempotence)', () => {
    /**
     * **Validates: Requirements 7.5**
     *
     * When refreshTokenIfNeeded is called and the token is still valid
     * (expiry is more than 5 minutes in the future), the function should
     * not call the refresh endpoint and should not update the stored token.
     * This ensures idempotent behavior for valid tokens.
     */

    it('does not call refresh endpoint when token is still valid', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // accountId
          uuidArb, // orgId
          // Generate a future expiry that is more than 5 minutes from now
          fc.integer({ min: 6, max: 1440 }), // minutes in the future (6 min to 24 hours)
          async (accountId, orgId, minutesInFuture) => {
            const tokenExpiry = new Date(Date.now() + minutesInFuture * 60 * 1000)

            const account = {
              id: accountId,
              accessToken: 'encrypted:valid-access-token',
              refreshToken: 'encrypted:valid-refresh-token',
              tokenExpiry,
            }

            mockDb.emailAccount.findFirst.mockResolvedValue(account)
            mockFetch.mockClear()

            await refreshTokenIfNeeded(accountId, orgId)

            // Should NOT have called fetch (no refresh needed)
            expect(mockFetch).not.toHaveBeenCalled()
            // Should NOT have updated the account
            expect(mockDb.emailAccount.update).not.toHaveBeenCalled()
          },
        ),
      )
    })

    it('stored token remains unchanged when token is valid', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // accountId
          uuidArb, // orgId
          fc.integer({ min: 10, max: 1440 }), // minutes in the future
          fc.string({ minLength: 10, maxLength: 50 }), // access token value
          fc.string({ minLength: 10, maxLength: 50 }), // refresh token value
          async (accountId, orgId, minutesInFuture, accessTokenVal, refreshTokenVal) => {
            const tokenExpiry = new Date(Date.now() + minutesInFuture * 60 * 1000)
            const encryptedAccess = `encrypted:${accessTokenVal}`
            const encryptedRefresh = `encrypted:${refreshTokenVal}`

            const account = {
              id: accountId,
              accessToken: encryptedAccess,
              refreshToken: encryptedRefresh,
              tokenExpiry,
            }

            mockDb.emailAccount.findFirst.mockResolvedValue(account)
            mockFetch.mockClear()
            mockDb.emailAccount.update.mockClear()

            await refreshTokenIfNeeded(accountId, orgId)

            // Token should not be modified
            expect(mockDb.emailAccount.update).not.toHaveBeenCalled()
            // No network call should be made
            expect(mockFetch).not.toHaveBeenCalled()
          },
        ),
      )
    })

    it('calls refresh endpoint only when token is within 5-minute buffer of expiry', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // accountId
          uuidArb, // orgId
          // Generate an expiry that is within 5 minutes from now (0 to 4.9 minutes)
          fc.integer({ min: 0, max: 299 }), // seconds in the future (0 to ~5 min)
          async (accountId, orgId, secondsInFuture) => {
            // Reset mocks for each iteration
            mockFetch.mockReset()
            mockDb.emailAccount.findFirst.mockReset()
            mockDb.emailAccount.update.mockReset()

            const tokenExpiry = new Date(Date.now() + secondsInFuture * 1000)

            const account = {
              id: accountId,
              accessToken: 'encrypted:old-access-token',
              refreshToken: 'encrypted:valid-refresh-token',
              tokenExpiry,
            }

            mockDb.emailAccount.findFirst.mockResolvedValue(account)
            mockFetch.mockResolvedValue({
              ok: true,
              json: async () => ({
                access_token: 'new-access-token',
                expires_in: 3600,
              }),
            })
            mockDb.emailAccount.update.mockResolvedValue({})

            await refreshTokenIfNeeded(accountId, orgId)

            // SHOULD have called fetch (refresh needed)
            expect(mockFetch).toHaveBeenCalledTimes(1)
            // SHOULD have updated the account with new token
            expect(mockDb.emailAccount.update).toHaveBeenCalledTimes(1)
          },
        ),
      )
    })
  })
})
