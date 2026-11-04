import 'server-only'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AppError, errorResponse } from '@/lib/errors'

const headers = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'Referrer-Policy': 'no-referrer',
}
export function pilotJson(data: unknown) {
  return NextResponse.json({ data }, { headers })
}
export async function pilotResponse(work: () => Promise<unknown>) {
  try {
    return pilotJson(await work())
  } catch (error) {
    if (error instanceof AppError || error instanceof ZodError) {
      const response = errorResponse(error)
      for (const [key, value] of Object.entries(headers))
        response.headers.set(key, value)
      return response
    }
    // Auth/bootstrap errors can contain credentials or input values. Do not log them.
    return NextResponse.json(
      {
        error: {
          code: 'PILOT_UNAVAILABLE',
          message:
            'Pilot setup could not be confirmed. Reload its status before retrying.',
        },
      },
      { status: 503, headers },
    )
  }
}
export function pilotCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  }
}
export function requirePilotOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    throw new AppError(
      'FORBIDDEN',
      'Use Flowrish to continue pilot setup.',
      403,
    )
}
