import { NextRequest, NextResponse } from 'next/server'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { createSupabaseMiddleware } from '@/lib/supabase/middleware'
import {
  selectedWorkspace,
  WORKSPACE_COOKIE,
  WORKSPACE_HEADER,
  WORKSPACE_METHOD_HEADER,
  WORKSPACE_PATH_HEADER,
} from '@/lib/workspace-context'

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

  // Rate limiting is a production safeguard. Skip it outside production so
  // local development — and the e2e smoke suite, which hits many routes in
  // parallel from a single localhost IP — don't trip the sliding-window
  // limit. Deployed environments (NODE_ENV=production) still enforce it, and
  // the `test:e2e:prod` profile serializes requests to respect the limiter.
  if (process.env.NODE_ENV !== 'production') {
    cachedLimiters = null
    return null
  }

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
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(WORKSPACE_METHOD_HEADER, request.method)
  requestHeaders.set(WORKSPACE_PATH_HEADER, request.nextUrl.pathname)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  const website =
    /^\/api\/public\/website-receptionist\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/(embed|session|message|callback)$/i.exec(
      request.nextUrl.pathname,
    )
  const publicWebsite = Boolean(
    website &&
    (website[1] === 'embed'
      ? ['GET', 'HEAD'].includes(request.method)
      : request.method === 'POST'),
  )
  const embeddedWebsite = publicWebsite && website?.[1] === 'embed'

  // 1. Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff')
  if (!embeddedWebsite) response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains',
  )
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set(
    'Permissions-Policy',
    // Documents keep their policy across client navigation to the microphone preview.
    'camera=(), microphone=(self), geolocation=(), payment=()',
  )

  // 2. Rate limiting (skip entirely when Redis isn't configured — see
  // getRateLimiters())
  const path = request.nextUrl.pathname

  // Static assets served from /public (logo, images, fonts, etc.) must
  // bypass the auth gate — otherwise an <img>/font request on a public
  // page (login, landing) would 302 to /login and fail to load. Any path
  // whose final segment has a file extension is treated as a static file.
  if (/\.[a-zA-Z0-9]+$/.test(path) && !path.startsWith('/api/')) {
    return response
  }

  // Only rate-limit the API. Page navigations and RSC payload requests are
  // GETs that just render — counting them against a per-IP limit means a
  // single person clicking around the app trips the limit (a real bug: it
  // 429'd normal browsing). Abuse protection belongs on the API surface
  // (auth attempts, writes, data reads), which is what we gate here.
  if (path.startsWith('/api/')) {
    const limiters = getRateLimiters()
    if (limiters) {
      const ip =
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        '127.0.0.1'

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
                'Strict-Transport-Security':
                  'max-age=31536000; includeSubDomains',
                'Referrer-Policy': 'strict-origin-when-cross-origin',
                'Permissions-Policy':
                  'camera=(), microphone=(), geolocation=(), payment=()',
              },
            },
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

  // The exact widget endpoints validate their own short-lived sessions and durable quotas.
  // The embed route supplies its tenant-specific frame-ancestors policy in Node.
  if (publicWebsite) return response

  // This static sample needs no session or organization data. Keep writes and
  // neighboring paths behind the normal authentication gate.
  if (path === '/demo' && ['GET', 'HEAD'].includes(request.method)) {
    return response
  }

  // Pilot entry and browser-session exchange do not grant organization access.
  const publicPilot =
    (path === '/pilot' && ['GET', 'HEAD'].includes(request.method)) ||
    (path === '/api/pilot/session' &&
      ['POST', 'DELETE'].includes(request.method)) ||
    (path === '/api/pilot/status' && request.method === 'GET')
  if (publicPilot) {
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
  }

  // 3. Auth check via Supabase (skip for auth callback/confirm — they handle their own session)
  const isAuthCallback =
    path.startsWith('/auth/callback') || path.startsWith('/auth/confirm')

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

  // Supabase may have refreshed request cookies after the initial header snapshot.
  const forwardedHeaders = new Headers(request.headers)
  forwardedHeaders.set(WORKSPACE_METHOD_HEADER, request.method)
  forwardedHeaders.set(WORKSPACE_PATH_HEADER, path)
  const forwarded = NextResponse.next({
    request: { headers: forwardedHeaders },
  })
  for (const [name, value] of forwarded.headers) {
    if (name.startsWith('x-middleware-')) response.headers.set(name, value)
  }

  const chosenWorkspace = user
    ? selectedWorkspace(request.cookies.get(WORKSPACE_COOKIE)?.value, user.id)
    : undefined
  const expectedWorkspace = request.headers.get(WORKSPACE_HEADER)
  if (
    path !== '/api/workspaces' &&
    chosenWorkspace &&
    expectedWorkspace &&
    expectedWorkspace !== chosenWorkspace
  ) {
    return NextResponse.json(
      {
        error: {
          code: 'WORKSPACE_CHANGED',
          message: 'The active business changed. Reload before continuing.',
        },
      },
      { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  const isPublicRoute =
    path === '/' || PUBLIC_ROUTES.some((route) => path.startsWith(route))
  const isApiRoute = path.startsWith('/api/')

  // Redirect unauthenticated page requests to login (except public routes)
  if (!user && !isPublicRoute && !isApiRoute) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  // Return 401 for unauthenticated API requests (except /api/auth,
  // /api/inngest and the Twilio voice webhooks, which validate requests
  // separately because Twilio calls them without an app session).
  if (
    !user &&
    isApiRoute &&
    !path.startsWith('/api/auth') &&
    !path.startsWith('/api/inngest') &&
    !path.startsWith('/api/voice/twiml') &&
    !/^\/api\/voice\/receptionist\/[^/]+$/.test(path)
  ) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 },
    )
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
