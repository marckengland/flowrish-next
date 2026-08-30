import { describe, it, expect } from 'vitest'
import { envSchema } from './env.schema'

/**
 * Tests for environment variable validation schema.
 * We test the exported schema directly rather than importing the `env` object,
 * which would throw at import time due to missing env vars in the test environment.
 *
 * Validates: Requirements 22.1, 22.2, 22.3, 22.4
 */

const validEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
  SUPABASE_SECRET_KEY: 'service-role-key-value',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  DIRECT_URL: 'postgresql://user:pass@localhost:5432/db',
  UPSTASH_REDIS_REST_URL: 'https://us1-redis.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'AXXXaaaa',
  INNGEST_SIGNING_KEY: 'signkey-test-abc123',
  INNGEST_EVENT_KEY: 'eventkey-test-abc123',
  GOOGLE_CLIENT_ID: '123456789.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-secret',
  EMAIL_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
  AI_API_KEY: 'AIzaSyTest123',
}

describe('env validation schema', () => {
  it('passes with all valid required env vars', () => {
    const result = envSchema.safeParse(validEnv)
    expect(result.success).toBe(true)
  })

  it('applies defaults for optional vars when absent', () => {
    const result = envSchema.safeParse(validEnv)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.AI_API_URL).toBe(
        'https://generativelanguage.googleapis.com/v1beta/openai'
      )
      expect(result.data.AI_MODEL).toBe('gemini-3.1-flash-lite')
    }
  })

  it('uses provided values for optional vars when present', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      AI_API_URL: 'https://custom-ai.example.com',
      AI_MODEL: 'gemini-pro',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.AI_API_URL).toBe('https://custom-ai.example.com')
      expect(result.data.AI_MODEL).toBe('gemini-pro')
    }
  })

  it('fails when a required URL var is not a valid URL', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain('NEXT_PUBLIC_SUPABASE_URL must be a valid URL')
    }
  })

  it('fails when DATABASE_URL is not a valid URL', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      DATABASE_URL: 'not-a-url',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain('DATABASE_URL must be a valid URL')
    }
  })

  it('fails when DIRECT_URL is not a valid URL', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      DIRECT_URL: 'not-a-url',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain('DIRECT_URL must be a valid URL')
    }
  })

  it('fails when UPSTASH_REDIS_REST_URL is not a valid URL', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      UPSTASH_REDIS_REST_URL: 'invalid',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain('UPSTASH_REDIS_REST_URL must be a valid URL')
    }
  })

  it('fails when a required key var is empty string', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      AI_API_KEY: '',
    })
    expect(result.success).toBe(false)
  })

  it('fails when a required var is missing', () => {
    const { DATABASE_URL, ...incomplete } = validEnv
    const result = envSchema.safeParse(incomplete)
    expect(result.success).toBe(false)
  })

  it('fails when optional AI_API_URL is provided but not a valid URL', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      AI_API_URL: 'not-a-url',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages).toContain('AI_API_URL must be a valid URL when provided')
    }
  })

  it('reports multiple errors when multiple vars are invalid', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'bad',
      UPSTASH_REDIS_REST_URL: 'bad',
      AI_API_KEY: '',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('returns typed data matching the schema on success', () => {
    const result = envSchema.safeParse(validEnv)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(typeof result.data.NEXT_PUBLIC_SUPABASE_URL).toBe('string')
      expect(typeof result.data.DATABASE_URL).toBe('string')
      expect(typeof result.data.AI_API_URL).toBe('string')
      expect(typeof result.data.AI_MODEL).toBe('string')
    }
  })

  describe('EMAIL_ENCRYPTION_KEY validation', () => {
    it('passes with valid 64-character hex string', () => {
      const result = envSchema.safeParse({
        ...validEnv,
        EMAIL_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      })
      expect(result.success).toBe(true)
    })

    it('fails when EMAIL_ENCRYPTION_KEY is too short', () => {
      const result = envSchema.safeParse({
        ...validEnv,
        EMAIL_ENCRYPTION_KEY: 'a1b2c3d4',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message)
        expect(messages).toContain(
          'EMAIL_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)'
        )
      }
    })

    it('fails when EMAIL_ENCRYPTION_KEY contains non-hex characters', () => {
      const result = envSchema.safeParse({
        ...validEnv,
        EMAIL_ENCRYPTION_KEY: 'g1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message)
        expect(messages).toContain('EMAIL_ENCRYPTION_KEY must be a valid hex string')
      }
    })

    it('fails when EMAIL_ENCRYPTION_KEY is too long', () => {
      const result = envSchema.safeParse({
        ...validEnv,
        EMAIL_ENCRYPTION_KEY:
          'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4ff',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('startup halt behavior', () => {
    it('validateEnv throws descriptive error on invalid env', async () => {
      // We test the error formatting by importing the module with invalid env
      // Since we can't easily mock process.env for the module-level call,
      // we test the schema's error output format directly
      const result = envSchema.safeParse({
        NEXT_PUBLIC_SUPABASE_URL: 'bad',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        // Verify errors contain path and message info for descriptive output
        for (const issue of result.error.issues) {
          expect(issue.path.length).toBeGreaterThan(0)
          expect(issue.message.length).toBeGreaterThan(0)
        }
      }
    })
  })
})
