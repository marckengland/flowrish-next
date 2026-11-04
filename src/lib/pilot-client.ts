'use client'
import type { z } from 'zod'
export class PilotClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}
export async function readPilot<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...init })
  const body = await response.json().catch(() => null)
  if (!response.ok)
    throw new PilotClientError(
      body?.error?.message ??
        'The request could not be confirmed. Reload its status before retrying.',
      response.status,
    )
  const parsed = schema.safeParse(body?.data)
  if (!parsed.success)
    throw new PilotClientError(
      'Unexpected response. Reload its status before retrying.',
      502,
    )
  return parsed.data
}
export const pilotJsonBody = (data: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
})
