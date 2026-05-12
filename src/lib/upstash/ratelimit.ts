import { Ratelimit } from '@upstash/ratelimit'
import { redis } from './redis'

/**
 * Rate limiter instances using Upstash Redis with sliding window algorithm.
 *
 * Three tiers:
 * - general: 100 requests per minute (standard API calls)
 * - auth: 10 requests per minute (login/signup endpoints)
 * - write: 30 requests per minute (POST/PUT/DELETE/PATCH operations)
 *
 * Validates: Requirements 15.1, 15.2
 */
export const rateLimiters = {
  general: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, '1m'),
    prefix: 'rl:general',
  }),
  auth: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1m'),
    prefix: 'rl:auth',
  }),
  write: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, '1m'),
    prefix: 'rl:write',
  }),
}

/**
 * Records a failed login attempt for the given IP+email combination.
 * After 5 failed attempts within 15 minutes, locks out that combination for 15 minutes.
 *
 * @returns true if the account is now locked out, false otherwise
 *
 * Validates: Requirements 15.4
 */
export async function recordLoginFailure(ip: string, email: string): Promise<boolean> {
  const key = `login_attempt:${ip}:${email.toLowerCase()}`
  const attempts = await redis.incr(key)

  // Set expiry on first attempt (15-minute window)
  if (attempts === 1) {
    await redis.expire(key, 900)
  }

  if (attempts >= 5) {
    const lockKey = `login_lockout:${ip}:${email.toLowerCase()}`
    await redis.set(lockKey, '1', { ex: 900 }) // 15-minute lockout
    return true
  }

  return false
}

/**
 * Checks whether the given IP+email combination is currently locked out
 * due to too many failed login attempts.
 *
 * The lockout persists for the full 15-minute duration even if a correct
 * password is submitted during the lockout period.
 *
 * Validates: Requirements 15.4
 */
export async function isLoginLockedOut(ip: string, email: string): Promise<boolean> {
  const lockKey = `login_lockout:${ip}:${email.toLowerCase()}`
  const result = await redis.get(lockKey)
  return result !== null
}

/**
 * Clears the failure counter and lockout for the given IP+email combination.
 * Called on successful login (outside of a lockout period).
 *
 * Validates: Requirements 15.5
 */
export async function clearLoginFailures(ip: string, email: string): Promise<void> {
  const key = `login_attempt:${ip}:${email.toLowerCase()}`
  const lockKey = `login_lockout:${ip}:${email.toLowerCase()}`
  await redis.del(key, lockKey)
}
