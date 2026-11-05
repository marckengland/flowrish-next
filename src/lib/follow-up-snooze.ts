import { z } from 'zod'
const version = z.string().regex(/^[a-f0-9]{64}$/)
export const followUpSnoozeInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('snooze'), expectedVersion: version, localTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), timeZone: z.string().min(1).max(100) }).strict(),
  z.object({ action: z.literal('wake'), expectedVersion: version }).strict(),
])
export const snoozeMetadata = z.object({ until: z.string().datetime().nullable(), timeZone: z.string(), revision: z.number().int().positive() })
export type SnoozeMetadata = z.infer<typeof snoozeMetadata>
export function tomorrowLocal(now = new Date()): string { const next = new Date(now); next.setDate(next.getDate() + 1); return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}T09:00` }
