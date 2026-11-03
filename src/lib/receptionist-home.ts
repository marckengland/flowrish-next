import { z } from 'zod'
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const readiness = z.object({ businessSaved: z.boolean(), provider: z.enum(['missing', 'paused', 'review', 'configured']), approvedDocuments: count, websiteSaved: z.boolean(), websiteValid: z.boolean(), websiteEnabled: z.boolean(), allowedWebsites: count.max(5), prerequisitesSaved: z.boolean() }).strict().superRefine((value, ctx) => {
  const ready = value.businessSaved && value.provider === 'configured' && value.approvedDocuments > 0 && value.websiteValid && value.allowedWebsites > 0
  if (value.prerequisitesSaved !== ready || !value.websiteSaved && (value.websiteValid || value.websiteEnabled || value.allowedWebsites > 0)) ctx.addIssue({ code: 'custom', message: 'Inconsistent saved prerequisites.' })
})
export const receptionistHomeSchema = z.object({ asOf: z.string().datetime(), businessName: z.string().min(1).max(120), canManage: z.boolean(), canWork: z.boolean(), readiness: readiness.nullable(), counts: z.object({ pendingHandoffs: count.nullable(), openCallbacks: count.nullable(), overdueCallbacks: count.nullable(), missedHandoffs: count.nullable(), missedContacts: count.nullable() }).strict(), targets: z.object({ enabled: z.boolean(), checkedAt: z.string().datetime().nullable() }).strict() }).strict().superRefine((value, ctx) => {
  const c = value.counts
  if (!value.canManage && !value.canWork || value.canManage !== (value.readiness !== null) || value.canManage !== (c.pendingHandoffs !== null) || value.canManage !== (c.missedHandoffs !== null) || value.canWork !== (c.openCallbacks !== null) || value.canWork !== (c.overdueCallbacks !== null) || value.canWork !== (c.missedContacts !== null) || (c.overdueCallbacks ?? 0) > (c.openCallbacks ?? 0) || (c.missedContacts ?? 0) > (c.openCallbacks ?? 0) || (c.missedHandoffs ?? 0) > (c.pendingHandoffs ?? 0)) ctx.addIssue({ code: 'custom', message: 'Inconsistent home visibility or counts.' })
})
export type ReceptionistHomeSnapshot = z.infer<typeof receptionistHomeSchema>
