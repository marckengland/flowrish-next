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
 *
 * Uses a lazy proxy so that validation only runs on first property access
 * at runtime — not at import/build time. This allows `next build` to
 * collect pages without requiring all env vars to be present during the
 * static analysis phase.
 *
 * At runtime (server start, request handling), the first access triggers
 * validation and caches the result. If any required variable is missing,
 * the process halts with a descriptive error.
 */
let _cachedEnv: Env | null = null

export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    if (!_cachedEnv) {
      _cachedEnv = validateEnv()
    }
    return _cachedEnv[prop as keyof Env]
  },
})
