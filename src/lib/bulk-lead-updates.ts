import { z } from 'zod'
import { leadStatusEnum } from './validators/leads'
export const BULK_LEAD_LIMIT = 100
export const BULK_USER_HEADER = 'x-flowrish-bulk-user'
export const bulkLeadChange = z.discriminatedUnion('field', [
  z.object({ field: z.literal('leadStatus'), value: leadStatusEnum }).strict(),
  z.object({ field: z.literal('assignedUserId'), value: z.string().uuid() }).strict(),
])
const version = z.string().datetime().transform(value => new Date(value).toISOString())
export const bulkLeadSelection = z.array(z.object({ id: z.string().uuid(), expectedUpdatedAt: version }).strict()).min(1).max(BULK_LEAD_LIMIT).refine(rows => new Set(rows.map(row => row.id)).size === rows.length, 'Select each lead only once.').transform(rows => [...rows].sort((a, b) => a.id.localeCompare(b.id)))
export const bulkLeadPreviewInput = z.object({ id: z.string().uuid(), leads: bulkLeadSelection, change: bulkLeadChange }).strict()
export const bulkLeadApplyInput = z.object({ id: z.string().uuid(), confirmed: z.literal(true) }).strict()
export const bulkLeadResult = z.object({ state: z.literal('applied'), id: z.string().uuid(), updated: z.number().int().min(0).max(BULK_LEAD_LIMIT), unchanged: z.number().int().min(0).max(BULK_LEAD_LIMIT), appliedAt: z.string().datetime() }).strict()
export const bulkLeadPreview = z.object({
  state: z.literal('preview'), id: z.string().uuid(), expiresAt: z.string().datetime(), change: bulkLeadChange,
  targetLabel: z.string(), rows: z.array(z.object({ id: z.string().uuid(), label: z.string(), before: z.string(), after: z.string(), changed: z.boolean() }).strict()).min(1).max(BULK_LEAD_LIMIT),
}).strict()
export const bulkLeadResponse = z.discriminatedUnion('state', [bulkLeadPreview, bulkLeadResult])
export const bulkLeadOptionsSchema = z.object({ owners: z.array(z.object({ id: z.string().uuid(), label: z.string() }).strict()).max(200), ownersTruncated: z.boolean() }).strict()
export const bulkLeadSnapshots = z.array(z.object({ id: z.string().uuid(), expectedUpdatedAt: version, oldValue: z.string().max(1000).nullable() }).strict()).min(1).max(BULK_LEAD_LIMIT)
export type BulkLeadChange = z.infer<typeof bulkLeadChange>
export type BulkLeadPreview = z.infer<typeof bulkLeadPreview>
export type BulkLeadResult = z.infer<typeof bulkLeadResult>
export type BulkLeadSelected = z.infer<typeof bulkLeadSelection>
