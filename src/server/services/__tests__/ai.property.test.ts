import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

vi.mock('@/lib/web/fetch-site', () => ({ fetchSiteText: async () => null }))

vi.mock('@/server/services/org-ai-provider', () => ({ resolveOrganizationAi: async () => null }))

vi.mock('@/server/services/knowledge', () => ({ getAirishKnowledge: async () => ({ text: '', sources: [] }) }))

// Every test here is property-based (`fc.assert` with numRuns: 30). Each run
// mocks the DB/fetch and round-trips JSON, costing ~1-3s locally — which
// intermittently exceeds Vitest's 5s default on slower/variable CI runners
// (the failures were timeouts, not assertion errors; there is no real delay in
// the code under test). Raise the per-test timeout file-wide so any of these
// property tests can complete their 30 runs under CI load.
vi.setConfig({ testTimeout: 15_000 })

/**
 * Property-based tests for AI service error handling and system prompt inclusion.
 *
 * These tests verify that:
 * 1. AI failures never expose API keys or internal system details in the response
 * 2. AI requests always include the immutable platform guardrail system
 *    message, with any admin-configured prompt layered in as subordinate
 *    customization when active
 *
 * **Validates: Requirements 8.5, 8.4**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  lead: {
    findFirst: vi.fn(),
  },
  company: {
    findFirst: vi.fn(),
  },
  aiPromptConfig: {
    findFirst: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['Lead', 'Company', 'AiPromptConfig'],
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

// We'll set env values dynamically per test
const mockEnv = {
  AI_API_KEY: 'sk-test-key-12345',
  AI_API_URL: 'https://api.example.com/v1',
  AI_MODEL: 'gemini-3.1-flash-lite',
}

vi.mock('@/lib/env', () => ({
  env: new Proxy({} as Record<string, string>, {
    get: (_target, prop: string) => {
      return (mockEnv as Record<string, string>)[prop] ?? `mock-${prop}`
    },
  }),
}))

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { generateEmail, researchAccount, chatMessage } from '@/server/services/ai'
import { AppError } from '@/lib/errors'

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid UUID */
const uuidArb = fc.uuid()

/** Generate random API keys that could leak */
const apiKeyArb = fc.oneof(
  fc.string({ minLength: 10, maxLength: 100 }),
  fc.constantFrom(
    'sk-1234567890abcdef',
    'AIzaSyB-test-key-value',
    'Bearer eyJhbGciOiJIUzI1NiJ9.test',
    'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  ),
  fc.stringMatching(/sk-[a-zA-Z0-9]{20,50}/),
)

/** Generate random URLs that could leak */
const urlArb = fc.oneof(
  fc.webUrl(),
  fc.constantFrom(
    'https://api.openai.com/v1/chat/completions',
    'https://generativelanguage.googleapis.com/v1beta/openai',
    'https://internal-service.corp.net:8443/ai',
  ),
)

/** Generate random model names that could leak */
const modelNameArb = fc.oneof(
  fc.string({ minLength: 3, maxLength: 50 }),
  fc.constantFrom(
    'gemini-3.1-flash-lite',
    'gpt-4-turbo',
    'claude-3-opus',
    'internal-model-v2',
  ),
)

/** Generate random error messages from an AI API */
const errorMessageArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 200 }),
  fc.constantFrom(
    'Invalid API key provided: sk-1234...cdef',
    'Rate limit exceeded for model gpt-4-turbo',
    'Connection refused to https://internal.api.com:8443',
    'Model gemini-2.5-flash not found',
    'Unauthorized: Bearer token expired',
    'ECONNREFUSED 10.0.0.1:443',
    'getaddrinfo ENOTFOUND api.internal.corp.net',
  ),
)

/** Generate HTTP error status codes */
const httpErrorStatusArb = fc.constantFrom(400, 401, 403, 404, 429, 500, 502, 503)

/** Generate a lead object for the AI service */
const leadArb = fc.record({
  id: uuidArb,
  firstName: fc.string({ minLength: 1, maxLength: 30 }),
  lastName: fc.string({ minLength: 1, maxLength: 30 }),
  title: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
  companyName: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
  companyIndustry: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
  deletedAt: fc.constant(null),
  activities: fc.constant([]),
})

/** Generate a company object for the AI service */
const companyArb = fc.record({
  id: uuidArb,
  name: fc.string({ minLength: 1, maxLength: 50 }),
  website: fc.oneof(fc.constant(null), fc.webUrl()),
  industry: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
})

/** Generate a system prompt string */
const systemPromptArb = fc.string({ minLength: 5, maxLength: 500 })

// ─── Sensitive patterns to check against ─────────────────────────────────────

/**
 * Checks that a string does not contain any sensitive information.
 * Returns true if the string is safe (no leaks detected).
 */
function assertNoSensitiveDataLeaked(
  errorMessage: string,
  apiKey: string,
  apiUrl: string,
  modelName: string,
): void {
  const lowerMessage = errorMessage.toLowerCase()

  // Must not contain the API key (or significant substrings of it)
  if (apiKey.length > 5) {
    expect(errorMessage).not.toContain(apiKey)
    // Check for partial key leaks (first 8+ chars)
    if (apiKey.length > 8) {
      expect(errorMessage).not.toContain(apiKey.substring(0, 8))
    }
  }

  // Must not contain the internal API URL
  if (apiUrl.length > 10) {
    expect(errorMessage).not.toContain(apiUrl)
  }

  // Must not contain the model name (unless it's a very short/generic string)
  if (modelName.length > 5) {
    expect(errorMessage).not.toContain(modelName)
  }

  // Must not contain common internal detail patterns
  expect(lowerMessage).not.toMatch(/api[_-]?key/i)
  expect(lowerMessage).not.toMatch(/bearer\s+[a-zA-Z0-9]/i)
  expect(lowerMessage).not.toMatch(/sk-[a-zA-Z0-9]{5,}/i)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AI Error Handling - Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Property: AI failures never expose API keys or internal system details in response', () => {
    /**
     * **Validates: Requirements 8.5**
     *
     * When the AI API fails (any error — HTTP errors, network errors, malformed
     * responses), the thrown AppError message must always be the generic
     * "AI service temporarily unavailable" and must never contain API keys,
     * internal URLs, model names, or other system details.
     */

    it('generateEmail: HTTP errors never expose sensitive details', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          uuidArb,
          apiKeyArb,
          urlArb,
          modelNameArb,
          httpErrorStatusArb,
          errorMessageArb,
          leadArb,
          async (leadId, userId, orgId, apiKey, apiUrl, modelName, status, errorBody, lead) => {
            // Set sensitive env values
            mockEnv.AI_API_KEY = apiKey
            mockEnv.AI_API_URL = apiUrl
            mockEnv.AI_MODEL = modelName

            // Mock lead found
            mockDb.lead.findFirst.mockResolvedValue({ ...lead, id: leadId })
            // No active system prompt
            mockDb.aiPromptConfig.findFirst.mockResolvedValue(null)

            // Mock fetch to return an HTTP error with potentially sensitive error body
            mockFetch.mockResolvedValue({
              ok: false,
              status,
              statusText: errorBody,
              json: async () => ({ error: { message: errorBody } }),
            })

            try {
              await generateEmail(leadId, userId, orgId)
              // If it doesn't throw, that's also acceptable (shouldn't happen with failed fetch)
            } catch (error) {
              expect(error).toBeInstanceOf(AppError)
              const appError = error as AppError
              expect(appError.message).toBe('AI service temporarily unavailable')
              expect(appError.statusCode).toBe(503)
              assertNoSensitiveDataLeaked(appError.message, apiKey, apiUrl, modelName)
            }
          },
        ),
        { numRuns: 50 },
      )
    })

    it('generateEmail: network errors never expose sensitive details', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          uuidArb,
          apiKeyArb,
          urlArb,
          modelNameArb,
          errorMessageArb,
          leadArb,
          async (leadId, userId, orgId, apiKey, apiUrl, modelName, networkError, lead) => {
            mockEnv.AI_API_KEY = apiKey
            mockEnv.AI_API_URL = apiUrl
            mockEnv.AI_MODEL = modelName

            mockDb.lead.findFirst.mockResolvedValue({ ...lead, id: leadId })
            mockDb.aiPromptConfig.findFirst.mockResolvedValue(null)

            // Mock fetch to throw a network error
            mockFetch.mockRejectedValue(new Error(networkError))

            try {
              await generateEmail(leadId, userId, orgId)
            } catch (error) {
              expect(error).toBeInstanceOf(AppError)
              const appError = error as AppError
              expect(appError.message).toBe('AI service temporarily unavailable')
              expect(appError.statusCode).toBe(503)
              assertNoSensitiveDataLeaked(appError.message, apiKey, apiUrl, modelName)
            }
          },
        ),
        { numRuns: 50 },
      )
    })

    it('researchAccount: HTTP errors never expose sensitive details', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          apiKeyArb,
          urlArb,
          modelNameArb,
          httpErrorStatusArb,
          errorMessageArb,
          companyArb,
          async (companyId, orgId, apiKey, apiUrl, modelName, status, errorBody, company) => {
            mockEnv.AI_API_KEY = apiKey
            mockEnv.AI_API_URL = apiUrl
            mockEnv.AI_MODEL = modelName

            mockDb.company.findFirst.mockResolvedValue({ ...company, id: companyId })
            mockDb.aiPromptConfig.findFirst.mockResolvedValue(null)

            mockFetch.mockResolvedValue({
              ok: false,
              status,
              statusText: errorBody,
              json: async () => ({ error: { message: errorBody } }),
            })

            try {
              await researchAccount(companyId, orgId)
            } catch (error) {
              expect(error).toBeInstanceOf(AppError)
              const appError = error as AppError
              expect(appError.message).toBe('AI service temporarily unavailable')
              expect(appError.statusCode).toBe(503)
              assertNoSensitiveDataLeaked(appError.message, apiKey, apiUrl, modelName)
            }
          },
        ),
        { numRuns: 50 },
      )
    })

    it('chatMessage: HTTP errors never expose sensitive details', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          apiKeyArb,
          urlArb,
          modelNameArb,
          httpErrorStatusArb,
          fc.string({ minLength: 1, maxLength: 100 }),
          async (userId, orgId, apiKey, apiUrl, modelName, status, message) => {
            mockEnv.AI_API_KEY = apiKey
            mockEnv.AI_API_URL = apiUrl
            mockEnv.AI_MODEL = modelName

            mockDb.aiPromptConfig.findFirst.mockResolvedValue(null)

            mockFetch.mockResolvedValue({
              ok: false,
              status,
              statusText: 'Error',
              json: async () => ({ error: { message: 'API error' } }),
            })

            try {
              await chatMessage(message, userId, orgId)
            } catch (error) {
              expect(error).toBeInstanceOf(AppError)
              const appError = error as AppError
              expect(appError.message).toBe('AI service temporarily unavailable')
              expect(appError.statusCode).toBe(503)
              assertNoSensitiveDataLeaked(appError.message, apiKey, apiUrl, modelName)
            }
          },
        ),
        { numRuns: 50 },
      )
    })

    it('chatMessage: network errors never expose sensitive details', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          apiKeyArb,
          urlArb,
          modelNameArb,
          errorMessageArb,
          fc.string({ minLength: 1, maxLength: 100 }),
          async (userId, orgId, apiKey, apiUrl, modelName, networkError, message) => {
            mockEnv.AI_API_KEY = apiKey
            mockEnv.AI_API_URL = apiUrl
            mockEnv.AI_MODEL = modelName

            mockDb.aiPromptConfig.findFirst.mockResolvedValue(null)

            mockFetch.mockRejectedValue(new Error(networkError))

            try {
              await chatMessage(message, userId, orgId)
            } catch (error) {
              expect(error).toBeInstanceOf(AppError)
              const appError = error as AppError
              expect(appError.message).toBe('AI service temporarily unavailable')
              expect(appError.statusCode).toBe(503)
              assertNoSensitiveDataLeaked(appError.message, apiKey, apiUrl, modelName)
            }
          },
        ),
        { numRuns: 50 },
      )
    })

    it('malformed AI responses never expose sensitive details', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          uuidArb,
          apiKeyArb,
          urlArb,
          modelNameArb,
          leadArb,
          async (leadId, userId, orgId, apiKey, apiUrl, modelName, lead) => {
            mockEnv.AI_API_KEY = apiKey
            mockEnv.AI_API_URL = apiUrl
            mockEnv.AI_MODEL = modelName

            mockDb.lead.findFirst.mockResolvedValue({ ...lead, id: leadId })
            mockDb.aiPromptConfig.findFirst.mockResolvedValue(null)

            // Mock fetch to return ok but with malformed JSON that causes parsing to throw
            mockFetch.mockResolvedValue({
              ok: true,
              json: async () => {
                throw new SyntaxError('Unexpected token in JSON')
              },
            })

            try {
              await generateEmail(leadId, userId, orgId)
            } catch (error) {
              expect(error).toBeInstanceOf(AppError)
              const appError = error as AppError
              expect(appError.message).toBe('AI service temporarily unavailable')
              expect(appError.statusCode).toBe(503)
              assertNoSensitiveDataLeaked(appError.message, apiKey, apiUrl, modelName)
            }
          },
        ),
        { numRuns: 30 },
      )
    })
  })

  describe('Property: AI requests always include the immutable platform guardrail; admin prompt is layered in (subordinate) when active', () => {
    /**
     * **Validates: Requirements 8.4**
     *
     * When an AiPromptConfig with isActive=true exists for the relevant key,
     * the system prompt must be included in the AI request messages.
     * When no active config exists, no system prompt should be included.
     */

    it('generateEmail includes system prompt when active config exists', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          uuidArb,
          systemPromptArb,
          leadArb,
          async (leadId, userId, orgId, systemPrompt, lead) => {
            mockDb.lead.findFirst.mockResolvedValue({ ...lead, id: leadId })
            mockDb.aiPromptConfig.findFirst.mockResolvedValue({
              id: 'config-1',
              key: 'email_generation',
              systemPrompt,
              isActive: true,
            })

            // Capture the fetch call to inspect the request body
            let capturedBody: string | undefined
            mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
              capturedBody = options.body as string
              return {
                ok: true,
                json: async () => ({
                  choices: [{ message: { content: '{"subject": "Hi", "body": "Hello"}' } }],
                }),
              }
            })

            await generateEmail(leadId, userId, orgId)

            expect(capturedBody).toBeDefined()
            const parsed = JSON.parse(capturedBody!)
            const systemMessages = parsed.messages.filter(
              (m: { role: string }) => m.role === 'system',
            )
            // One system message: the immutable guardrail with the admin
            // prompt layered in as a subordinate customization block.
            expect(systemMessages).toHaveLength(1)
            expect(systemMessages[0].content).toContain('B2B sales CRM')
            expect(systemMessages[0].content).toContain(systemPrompt)
            expect(systemMessages[0].content).toContain('Organization customization')
          },
        ),
        { numRuns: 30 },
      )
    })

    it('generateEmail still sends the platform guardrail when no active config exists', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          uuidArb,
          leadArb,
          async (leadId, userId, orgId, lead) => {
            mockDb.lead.findFirst.mockResolvedValue({ ...lead, id: leadId })
            // No active prompt config
            mockDb.aiPromptConfig.findFirst.mockResolvedValue(null)

            let capturedBody: string | undefined
            mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
              capturedBody = options.body as string
              return {
                ok: true,
                json: async () => ({
                  choices: [{ message: { content: '{"subject": "Hi", "body": "Hello"}' } }],
                }),
              }
            })

            await generateEmail(leadId, userId, orgId)

            expect(capturedBody).toBeDefined()
            const parsed = JSON.parse(capturedBody!)
            const systemMessages = parsed.messages.filter(
              (m: { role: string }) => m.role === 'system',
            )
            // Guardrail is always present; with no admin config there is no
            // subordinate customization block.
            expect(systemMessages).toHaveLength(1)
            expect(systemMessages[0].content).toContain('B2B sales CRM')
            expect(systemMessages[0].content).not.toContain('Organization customization')
          },
        ),
        { numRuns: 30 },
      )
    })

    it('researchAccount includes system prompt when active config exists', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          systemPromptArb,
          companyArb,
          async (companyId, orgId, systemPrompt, company) => {
            mockDb.company.findFirst.mockResolvedValue({ ...company, id: companyId })
            mockDb.aiPromptConfig.findFirst.mockResolvedValue({
              id: 'config-2',
              key: 'account_research',
              systemPrompt,
              isActive: true,
            })

            let capturedBody: string | undefined
            mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
              capturedBody = options.body as string
              return {
                ok: true,
                json: async () => ({
                  choices: [{
                    message: {
                      content: '{"executiveSummary": "Test", "strategicGoals": "Goals", "salesAngles": [], "challenges": []}',
                    },
                  }],
                }),
              }
            })

            await researchAccount(companyId, orgId)

            expect(capturedBody).toBeDefined()
            const parsed = JSON.parse(capturedBody!)
            const systemMessages = parsed.messages.filter(
              (m: { role: string }) => m.role === 'system',
            )
            // One system message: the immutable guardrail with the admin
            // prompt layered in as a subordinate customization block.
            expect(systemMessages).toHaveLength(1)
            expect(systemMessages[0].content).toContain('B2B sales CRM')
            expect(systemMessages[0].content).toContain(systemPrompt)
            expect(systemMessages[0].content).toContain('Organization customization')
          },
        ),
        { numRuns: 30 },
      )
    })

    it('researchAccount still sends the platform guardrail when no active config exists', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          companyArb,
          async (companyId, orgId, company) => {
            mockDb.company.findFirst.mockResolvedValue({ ...company, id: companyId })
            mockDb.aiPromptConfig.findFirst.mockResolvedValue(null)

            let capturedBody: string | undefined
            mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
              capturedBody = options.body as string
              return {
                ok: true,
                json: async () => ({
                  choices: [{
                    message: {
                      content: '{"executiveSummary": "Test", "strategicGoals": "Goals", "salesAngles": [], "challenges": []}',
                    },
                  }],
                }),
              }
            })

            await researchAccount(companyId, orgId)

            expect(capturedBody).toBeDefined()
            const parsed = JSON.parse(capturedBody!)
            const systemMessages = parsed.messages.filter(
              (m: { role: string }) => m.role === 'system',
            )
            // Guardrail is always present; with no admin config there is no
            // subordinate customization block.
            expect(systemMessages).toHaveLength(1)
            expect(systemMessages[0].content).toContain('B2B sales CRM')
            expect(systemMessages[0].content).not.toContain('Organization customization')
          },
        ),
        { numRuns: 30 },
      )
    })

    it('chatMessage includes system prompt when active config exists', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          systemPromptArb,
          fc.string({ minLength: 1, maxLength: 100 }),
          async (userId, orgId, systemPrompt, userMessage) => {
            mockDb.aiPromptConfig.findFirst.mockResolvedValue({
              id: 'config-3',
              key: 'chatbot',
              systemPrompt,
              isActive: true,
            })

            let capturedBody: string | undefined
            mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
              capturedBody = options.body as string
              return {
                ok: true,
                json: async () => ({
                  choices: [{ message: { content: 'AI response' } }],
                }),
              }
            })

            await chatMessage(userMessage, userId, orgId)

            expect(capturedBody).toBeDefined()
            const parsed = JSON.parse(capturedBody!)
            const systemMessages = parsed.messages.filter(
              (m: { role: string }) => m.role === 'system',
            )
            // One system message: the immutable guardrail with the admin
            // prompt layered in as a subordinate customization block.
            expect(systemMessages).toHaveLength(1)
            expect(systemMessages[0].content).toContain('B2B sales CRM')
            expect(systemMessages[0].content).toContain(systemPrompt)
            expect(systemMessages[0].content).toContain('Organization customization')
          },
        ),
        { numRuns: 30 },
      )
    })

    it('chatMessage still sends the platform guardrail when no active config exists', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          fc.string({ minLength: 1, maxLength: 100 }),
          async (userId, orgId, userMessage) => {
            mockDb.aiPromptConfig.findFirst.mockResolvedValue(null)

            let capturedBody: string | undefined
            mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
              capturedBody = options.body as string
              return {
                ok: true,
                json: async () => ({
                  choices: [{ message: { content: 'AI response' } }],
                }),
              }
            })

            await chatMessage(userMessage, userId, orgId)

            expect(capturedBody).toBeDefined()
            const parsed = JSON.parse(capturedBody!)
            const systemMessages = parsed.messages.filter(
              (m: { role: string }) => m.role === 'system',
            )
            // Guardrail is always present; with no admin config there is no
            // subordinate customization block.
            expect(systemMessages).toHaveLength(1)
            expect(systemMessages[0].content).toContain('B2B sales CRM')
            expect(systemMessages[0].content).not.toContain('Organization customization')
          },
        ),
        { numRuns: 30 },
      )
    })
  })
})
