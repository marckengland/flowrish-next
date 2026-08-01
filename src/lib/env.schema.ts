import { z } from 'zod'

/**
 * Zod schema for validating all required and optional environment variables.
 * URL-type vars are validated as valid URLs; key-type vars as non-empty strings.
 * Optional vars have sensible defaults.
 *
 * Validates: Requirements 22.1, 22.2, 22.3, 22.4
 */
export const envSchema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required'),
  SUPABASE_SECRET_KEY: z.string().min(1, 'SUPABASE_SECRET_KEY is required'),

  // Database (Prisma) — pooled connection for queries, direct for migrations
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  DIRECT_URL: z.string().url('DIRECT_URL must be a valid URL'),

  // Upstash Redis
  UPSTASH_REDIS_REST_URL: z.string().url('UPSTASH_REDIS_REST_URL must be a valid URL'),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'UPSTASH_REDIS_REST_TOKEN is required'),

  // Inngest
  INNGEST_SIGNING_KEY: z.string().min(1, 'INNGEST_SIGNING_KEY is required'),
  INNGEST_EVENT_KEY: z.string().min(1, 'INNGEST_EVENT_KEY is required'),

  // Google OAuth (Gmail)
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),

  // Email encryption — 32 bytes as hex (64 hex characters)
  EMAIL_ENCRYPTION_KEY: z
    .string()
    .length(64, 'EMAIL_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)')
    .regex(/^[0-9a-fA-F]+$/, 'EMAIL_ENCRYPTION_KEY must be a valid hex string'),

  // AI (Gemini)
  AI_API_KEY: z.string().min(1, 'AI_API_KEY is required'),

  // Optional with defaults
  AI_API_URL: z
    .string()
    .url('AI_API_URL must be a valid URL when provided')
    .default('https://generativelanguage.googleapis.com/v1beta/openai'),
  AI_MODEL: z.string().min(1).default('gemini-2.5-flash-lite-preview'),
})

export type Env = z.infer<typeof envSchema>
