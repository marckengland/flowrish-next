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

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const rateLimiters = {
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

// --- Constants ---

const PUBLIC_ROUTES = ['/login', '/auth/callback', '/auth/confirm', '/onboarding']

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

  // 2. Rate limiting (skip for static assets)
  const path = request.nextUrl.pathname

  if (!path.startsWith('/_next') && !path.startsWith('/favicon')) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'

    const limiter = path.startsWith('/api/auth')
      ? rateLimiters.auth
      : ['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)
        ? rateLimiters.write
        : rateLimiters.general

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
  }

  // 3. Auth check via Supabase
  const supabase = createSupabaseMiddleware(request, response)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isPublicRoute = PUBLIC_ROUTES.some((route) => path.startsWith(route))
  const isApiRoute = path.startsWith('/api/')

  // Redirect unauthenticated page requests to login (except public routes)
  if (!user && !isPublicRoute && !isApiRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Return 401 for unauthenticated API requests (except /api/auth and /api/inngest)
  if (!user && isApiRoute && !path.startsWith('/api/auth') && !path.startsWith('/api/inngest')) {
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
