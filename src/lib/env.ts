import { envSchema, type Env } from './env.schema'

export { envSchema, type Env } from './env.schema'

/**
 * Validates process.env against the schema.
 * Throws a descriptive error listing all invalid/missing variables on failure.
 */
export function validateEnv(): Env {
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
