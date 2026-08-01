import { NextRequest, NextResponse } from 'next/server'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { createSupabaseMiddleware } from '@/lib/supabase/middleware'

/**
 * Next.js middleware handling security headers, rate limiting, and authentication.
 *
 * Uses process.env directly (not env.ts) because middleware runs at the edge
 * and env.ts validates ALL env vars — some of which may not be available in edge runtime.
 *
 * Validates: Requirements 1.5, 1.7, 15.1, 15.2, 15.3, 21.1
 */

// --- Rate Limiters (edge-compatible, using process.env directly) ---

/**
 * Build the rate-limit registry only when Upstash credentials are
 * available. Local development typically runs without Redis, and we
 * never want middleware to 500 on every request just because the
 * limiter can't reach a backend — so a missing config means
 * "rate-limit-disabled" rather than "fail closed".
 *
 * The registry is built lazily on first use (one-shot module-scoped
 * cache) so production paths still pay the construction cost exactly
 * once.
 */
type RateLimiterSet = {
  general: Ratelimit
  auth: Ratelimit
  write: Ratelimit
}

let cachedLimiters: RateLimiterSet | null | undefined

function getRateLimiters(): RateLimiterSet | null {
  if (cachedLimiters !== undefined) return cachedLimiters

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    cachedLimiters = null
    return null
  }

  const redis = new Redis({ url, token })
  cachedLimiters = {
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
  return cachedLimiters
}

// --- Constants ---

// Routes reachable without authentication. `/` is the public marketing
// landing page. Others are the auth entry + callback handlers. Matched
// with startsWith, except `/` which is matched exactly (below) so it
// doesn't shadow every route.
const PUBLIC_ROUTES = ['/login', '/auth/callback', '/auth/confirm']

// --- Middleware ---

export async function middleware(request: NextRequest) {
  const response = NextResponse.next()

  // 1. Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  )

  // 2. Rate limiting (skip for static assets, and skip entirely when
  // Redis isn't configured — see getRateLimiters())
  const path = request.nextUrl.pathname

  // Static assets served from /public (logo, images, fonts, etc.) must
  // bypass the auth gate — otherwise an <img>/font request on a public
  // page (login, landing) would 302 to /login and fail to load. Any path
  // whose final segment has a file extension is treated as a static file.
  if (/\.[a-zA-Z0-9]+$/.test(path) && !path.startsWith('/api/')) {
    return response
  }

  if (!path.startsWith('/_next') && !path.startsWith('/favicon')) {
    const limiters = getRateLimiters()
    if (limiters) {
      const ip =
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        ?? '127.0.0.1'

      const limiter = path.startsWith('/api/auth')
        ? limiters.auth
        : ['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)
          ? limiters.write
          : limiters.general

      try {
        const { success, limit, remaining, reset } = await limiter.limit(ip)

        response.headers.set('X-RateLimit-Limit', limit.toString())
        response.headers.set('X-RateLimit-Remaining', remaining.toString())
        response.headers.set('X-RateLimit-Reset', reset.toString())

        if (!success) {
          return NextResponse.json(
            { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
            {
              status: 429,
              headers: {
                'X-RateLimit-Limit': limit.toString(),
                'X-RateLimit-Remaining': remaining.toString(),
                'X-RateLimit-Reset': reset.toString(),
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
                'Referrer-Policy': 'strict-origin-when-cross-origin',
                'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
              },
            }
          )
        }
      } catch (err) {
        // A transient Redis blip should not 500 the entire app. Log
        // once and let the request through — the request will still
        // be auth-checked below. Production deployments where Redis
        // is critical should monitor this log line.
        console.warn(
          '[middleware] rate-limit check failed; allowing request:',
          err instanceof Error ? err.message : err,
        )
      }
    }
  }

  // 3. Auth check via Supabase (skip for auth callback/confirm — they handle their own session)
  const isAuthCallback = path.startsWith('/auth/callback') || path.startsWith('/auth/confirm')

  if (isAuthCallback) {
    return response
  }

  const supabase = createSupabaseMiddleware(request, response)

  // When Supabase isn't configured (local dev without credentials),
  // skip the auth gate so static / public routes still render. The
  // app's data layer will surface its own "not signed in" errors when
  // it tries to query the DB, and the login page will render without
  // crashing.
  if (!supabase) {
    return response
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isPublicRoute =
    path === '/' || PUBLIC_ROUTES.some((route) => path.startsWith(route))
  const isApiRoute = path.startsWith('/api/')

  // Redirect unauthenticated page requests to login (except public routes)
  if (!user && !isPublicRoute && !isApiRoute) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  // Return 401 for unauthenticated API requests (except /api/auth,
  // /api/inngest, and /api/voice/twiml — the last is a Twilio webhook that
  // Twilio calls directly with no app session).
  if (
    !user
    && isApiRoute
    && !path.startsWith('/api/auth')
    && !path.startsWith('/api/inngest')
    && !path.startsWith('/api/voice/twiml')
  ) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    )
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
