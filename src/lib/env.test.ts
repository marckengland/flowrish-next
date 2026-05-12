import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'

/**
 * We test the env schema validation logic directly rather than importing
 * the env module (which would throw at import time due to missing env vars in test).
 * We re-create the schema here to test validation behavior.
 */
const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required'),
  UPSTASH_REDIS_REST_URL: z.string().url('UPSTASH_REDIS_REST_URL must be a valid URL'),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'UPSTASH_REDIS_REST_TOKEN is required'),
  INNGEST_SIGNING_KEY: z.string().min(1, 'INNGEST_SIGNING_KEY is required'),
  INNGEST_EVENT_KEY: z.string().min(1, 'INNGEST_EVENT_KEY is required'),
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
  EMAIL_ENCRYPTION_KEY: z.string().min(1, 'EMAIL_ENCRYPTION_KEY is required'),
  AI_API_KEY: z.string().min(1, 'AI_API_KEY is required'),
  AI_API_URL: z
    .string()
    .url('AI_API_URL must be a valid URL when provided')
    .default('https://generativelanguage.googleapis.com'),
  AI_MODEL: z.string().min(1).default('gemini-2.0-flash'),
})

const validEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-value',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  DIRECT_URL: 'postgresql://user:pass@localhost:5432/db',
  UPSTASH_REDIS_REST_URL: 'https://us1-redis.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'AXXXaaaa',
  INNGEST_SIGNING_KEY: 'signkey-test-abc123',
  INNGEST_EVENT_KEY: 'eventkey-test-abc123',
  GOOGLE_CLIENT_ID: '123456789.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-secret',
  EMAIL_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
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
      expect(result.data.AI_API_URL).toBe('https://generativelanguage.googleapis.com')
      expect(result.data.AI_MODEL).toBe('gemini-2.0-flash')
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
      // Verify all required fields are present and typed
      expect(typeof result.data.NEXT_PUBLIC_SUPABASE_URL).toBe('string')
      expect(typeof result.data.DATABASE_URL).toBe('string')
      expect(typeof result.data.AI_API_URL).toBe('string')
      expect(typeof result.data.AI_MODEL).toBe('string')
    }
  })
})
