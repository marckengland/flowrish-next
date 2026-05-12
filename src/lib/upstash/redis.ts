import { Redis } from '@upstash/redis'
import { env } from '@/lib/env'

/**
 * Upstash Redis client instance (REST-based, serverless-compatible).
 * Used for rate limiting, brute-force protection counters, and round-robin state.
 */
export const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
})
