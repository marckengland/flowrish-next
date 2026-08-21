import { z } from 'zod'

/**
 * Dangerous keys that indicate prototype pollution attempts.
 */
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype']

/**
 * Checks if an object (or nested objects) contains prototype pollution keys.
 * Uses Object.getOwnPropertyNames to catch __proto__ even when set via object literal,
 * and also checks Object.keys for JSON.parse'd objects.
 */
export function hasPrototypePollution(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) return false
  if (Array.isArray(obj)) {
    return obj.some(item => hasPrototypePollution(item))
  }
  const keys = Object.getOwnPropertyNames(obj)
  if (keys.some(k => DANGEROUS_KEYS.includes(k))) return true
  return keys
    .map(k => (obj as Record<string, unknown>)[k])
    .some(v => hasPrototypePollution(v))
}

/**
 * Sanitized string schema for arbitrary user-provided text.
 *
 * Strips null bytes and caps length. It deliberately does NOT reject the
 * `..` sequence: these validators back free-text fields (names, subjects,
 * email bodies, notes, descriptions) where `..`/`...` (ellipses) are
 * completely legitimate. Path-traversal protection only makes sense for
 * values used as filesystem paths — see {@link safeFileName}, which is
 * applied at the file-upload boundary instead.
 */
export const sanitizedString = z
  .string()
  .transform(s => s.replace(/\0/g, '')) // Strip null bytes
  .refine(s => s.length <= 10000, { message: 'String too long' })

/**
 * Optional sanitized string — allows undefined/empty but applies sanitization when present.
 */
export const optionalSanitizedString = z
  .string()
  .optional()
  .transform(s => (s ? s.replace(/\0/g, '') : s))
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
  .refine(s => s === null || s === undefined || s.length <= 10000, {
    message: 'String too long',
  })

/**
 * Filename validator for uploaded files. This is where path-traversal
 * protection actually belongs — the value is used to build a storage
 * path (e.g. `cadences/{orgId}/{stepId}/{id}-{filename}`), so it must not
 * contain traversal sequences or path separators.
 *
 * Rejects: null bytes, `..` sequences, and `/` or `\` separators.
 */
export const safeFileName = z
  .string()
  .transform(s => s.replace(/\0/g, ''))
  .refine(s => s.trim().length > 0, { message: 'Filename is required' })
  .refine(s => s.length <= 255, { message: 'Filename too long' })
  .refine(s => !s.includes('..'), { message: 'Invalid filename: path traversal detected' })
  .refine(s => !s.includes('/') && !s.includes('\\'), {
    message: 'Invalid filename: path separators are not allowed',
  })

/**
 * Safe JSON body schema that rejects prototype pollution attempts.
 * Use this to validate raw JSON request bodies before further parsing.
 * Uses z.any() with superRefine to check the raw input before Zod's record
 * parsing strips __proto__ keys.
 */
export const safeJsonBody = z
  .any()
  .refine(
    (val) => typeof val === 'object' && val !== null && !Array.isArray(val),
    { message: 'Expected an object' }
  )
  .refine((obj) => !hasPrototypePollution(obj), { message: 'Invalid input' })
  .transform((obj) => obj as Record<string, unknown>)

/**
 * Pagination schema with sensible defaults.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type PaginationInput = z.infer<typeof paginationSchema>
