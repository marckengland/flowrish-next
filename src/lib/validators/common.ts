import { z } from 'zod'

/**
 * Checks if an object (or nested objects) contains prototype pollution keys.
 */
export function hasPrototypePollution(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) return false
  const keys = Object.keys(obj)
  if (keys.some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) return true
  return Object.values(obj as Record<string, unknown>).some(v => hasPrototypePollution(v))
}

/**
 * Sanitized string schema that strips null bytes and detects path traversal sequences.
 * Use this for all user-provided string inputs.
 */
export const sanitizedString = z
  .string()
  .transform(s => s.replace(/\0/g, '')) // Strip null bytes
  .refine(s => !s.includes('..'), { message: 'Path traversal detected' })
  .refine(s => s.length <= 10000, { message: 'String too long' })

/**
 * Optional sanitized string — allows undefined/empty but applies sanitization when present.
 */
export const optionalSanitizedString = z
  .string()
  .optional()
  .transform(s => (s ? s.replace(/\0/g, '') : s))
  .refine(s => s === undefined || !s.includes('..'), { message: 'Path traversal detected' })
  .refine(s => s === undefined || s.length <= 10000, { message: 'String too long' })

/**
 * Nullable sanitized string — allows null but applies sanitization when present.
 */
export const nullableSanitizedString = z
  .string()
  .nullable()
  .optional()
  .transform(s => {
    if (s === null || s === undefined) return s
    return s.replace(/\0/g, '')
  })
  .refine(s => s === null || s === undefined || !s.includes('..'), {
    message: 'Path traversal detected',
  })
  .refine(s => s === null || s === undefined || s.length <= 10000, {
    message: 'String too long',
  })

/**
 * Safe JSON body schema that rejects prototype pollution attempts.
 * Use this to validate raw JSON request bodies before further parsing.
 */
export const safeJsonBody = z
  .record(z.unknown())
  .refine(obj => !hasPrototypePollution(obj), { message: 'Invalid input' })

/**
 * Pagination schema with sensible defaults.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type PaginationInput = z.infer<typeof paginationSchema>
