import { z } from 'zod'

/**
 * Zod schema for validating all required and optional environment variables.
 * URL-type vars are validated as valid URLs; key-type vars as non-empty strings.
 * Optional vars have sensible defaults.
 */
const envSchema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),

  // Database (Prisma)
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required'),

  // Upstash Redis
  UPSTASH_REDIS_REST_URL: z.string().url('UPSTASH_REDIS_REST_URL must be a valid URL'),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'UPSTASH_REDIS_REST_TOKEN is required'),

  // Inngest
  INNGEST_SIGNING_KEY: z.string().min(1, 'INNGEST_SIGNING_KEY is required'),
  INNGEST_EVENT_KEY: z.string().min(1, 'INNGEST_EVENT_KEY is required'),

  // Google OAuth (Gmail)
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),

  // Email encryption
  EMAIL_ENCRYPTION_KEY: z.string().min(1, 'EMAIL_ENCRYPTION_KEY is required'),

  // AI (Gemini)
  AI_API_KEY: z.string().min(1, 'AI_API_KEY is required'),

  // Optional with defaults
  AI_API_URL: z
    .string()
    .url('AI_API_URL must be a valid URL when provided')
    .default('https://generativelanguage.googleapis.com'),
  AI_MODEL: z.string().min(1).default('gemini-2.0-flash'),
})

export type Env = z.infer<typeof envSchema>

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  ✗ ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')

    throw new Error(
      `\n❌ Environment variable validation failed:\n\n${errors}\n\n` +
        `Please check your .env file or deployment environment.\n`
    )
  }

  return result.data
}

/**
 * Typed, validated environment variables.
 * Importing this module will halt startup if any required variable is missing or invalid.
 */
export const env = validateEnv()
