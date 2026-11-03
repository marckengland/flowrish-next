import { z } from 'zod'
import { websiteAdminSchema } from './website-receptionist'
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const setupBusinessValuesSchema = z.object({
  businessName: z.string().trim().max(120),
  timeZone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }, 'Choose a valid time zone.'),
  opensAt: time, closesAt: time, businessDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(value => new Set(value).size === value.length, 'List each business day once.'),
}).strict().refine(value => value.opensAt < value.closesAt, 'Closing time must follow opening time on the same day.')
export const setupBusinessSchema = setupBusinessValuesSchema.refine(value => value.businessName.length > 0, 'Enter your business name.')
export const setupBusinessWriteSchema = z.object({ values: setupBusinessSchema, expectedUpdatedAt: z.string().datetime().nullable() }).strict()
export const setupLaunchSchema = z.object({ expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), simulationReviewed: z.literal(true), acknowledged: z.literal(true) }).strict()
export const setupSnapshotSchema = z.object({
  version: z.string().regex(/^[a-f0-9]{64}$/), checkedAt: z.string().datetime(),
  business: z.object({ values: setupBusinessValuesSchema, saved: z.boolean(), updatedAt: z.string().datetime().nullable(), phoneEnabled: z.boolean() }).strict(),
  website: websiteAdminSchema,
  knowledge: z.object({ total: z.number().int().nonnegative(), published: z.number().int().nonnegative(), approved: z.number().int().nonnegative(), approvedCategories: z.array(z.string().max(100)).max(20), sample: z.object({ category: z.string().max(100), text: z.string().min(1).max(1200) }).strict().nullable() }).strict(),
  readyToEnable: z.boolean(),
}).strict()
export type SetupBusiness = z.infer<typeof setupBusinessSchema>
export type SetupSnapshot = z.infer<typeof setupSnapshotSchema>
export function businessHoursTemplate(values: SetupBusiness) {
  const business = setupBusinessSchema.parse(values)
  return { title: `${business.businessName} opening hours`.slice(0, 160), category: 'GENERAL' as const, contentText: `${business.businessName}\n\nBusiness hours (${business.timeZone}):\n${days.map((day, index) => `${day}: ${business.businessDays.includes(index) ? `${business.opensAt}–${business.closesAt}` : 'Closed'}`).join('\n')}` }
}
