import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import type { ApiErrorBody } from '@/types/api'

/**
 * Application error class for structured error handling.
 *
 * Use this to throw errors with a specific code and HTTP status
 * that will be serialized into the standard error response format.
 */
export class AppError extends Error {
  constructor(
    public code: string,
    public override message: string,
    public statusCode: number = 500,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/**
 * Produces a consistent JSON error response for Next.js Route Handlers.
 *
 * Handles three cases:
 * - ZodError → 400 with first validation error message
 * - AppError → custom status code with error code and message
 * - Unknown errors → 500 with generic message (no internals exposed)
 */
export function errorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.statusCode },
    )
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: error.issues[0].message } },
      { status: 400 },
    )
  }

  // Never expose internals for unknown errors
  console.error('Unhandled error:', error)
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
    { status: 500 },
  )
}
