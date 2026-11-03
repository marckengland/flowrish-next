import { z } from 'zod'
import { phoneSchema } from './receptionist'
import { callbackCalendarSchema, preferredTimeInputSchema, preferredTimeSchema } from './callback-time'

export const WEBSITE_REPLY_INPUT_BYTES = 9000
export const WEBSITE_REPLY_OUTPUT_TOKENS = 400
export const WEBSITE_REPLY_RESERVATION = WEBSITE_REPLY_INPUT_BYTES + 256 + WEBSITE_REPLY_OUTPUT_TOKENS
export const WEBSITE_SESSION_TURNS = 6
const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !value.includes('\0'), 'Unsupported text.')
export const websiteOriginSchema = z.string().trim().max(300).transform((value, ctx) => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || value.includes('*') || /[*%]/.test(url.hostname)) throw new Error()
    return url.origin
  } catch { ctx.addIssue({ code: 'custom', message: 'Use an exact HTTPS website origin without a path, wildcard, or credentials.' }); return z.NEVER }
})
const limits = { dailyMessageLimit: z.number().int().min(1).max(20), dailyTokenLimit: z.number().int().min(WEBSITE_REPLY_RESERVATION).max(200000), dailyCallbackLimit: z.number().int().min(1).max(50) }
export const websiteReceptionistSaveSchema = z.object({ enabled: z.boolean(), allowedOrigins: z.array(websiteOriginSchema).max(5), ...limits, expectedUpdatedAt: z.string().datetime().nullable(), acknowledged: z.boolean() }).strict().superRefine((value, ctx) => {
  if (new Set(value.allowedOrigins).size !== value.allowedOrigins.length) ctx.addIssue({ code: 'custom', message: 'List each website only once.' })
  if (value.enabled && (!value.acknowledged || !value.allowedOrigins.length)) ctx.addIssue({ code: 'custom', message: 'Choose an allowed website and acknowledge AI usage before enabling.' })
})
export const websiteSettingsSchema = z.object({ publicId: z.string().uuid(), enabled: z.boolean(), allowedOrigins: z.array(websiteOriginSchema).max(5), ...limits, updatedAt: z.string().datetime() }).strict()
const usageSchema = z.object({ sessions: z.number().int().nonnegative(), messages: z.number().int().nonnegative(), reservedTokens: z.number().int().nonnegative(), callbacks: z.number().int().nonnegative() }).strict()
export const websiteAdminSchema = z.object({ settings: websiteSettingsSchema.nullable(), hasSavedBusiness: z.boolean(), approvedDocuments: z.number().int().nonnegative(), hasOrganizationAi: z.boolean(), usage: usageSchema }).strict()
export const websiteSessionInputSchema = z.object({ siteOrigin: websiteOriginSchema, website: z.literal('') }).strict()
export const websiteMessageInputSchema = z.object({ requestId: z.string().uuid(), expectedTurn: z.number().int().min(0).max(WEBSITE_SESSION_TURNS), question: text(1000).refine(value => new TextEncoder().encode(value).length <= 2000, 'Use a shorter question.'), history: z.array(text(1000)).max(4).refine(value => new TextEncoder().encode(value.join('\n')).length <= 4000, 'Use a shorter chat history.'), website: z.literal('') }).strict()
export const websiteCallbackInputSchema = z.object({ fullName: text(120), phone: phoneSchema, reason: text(1000), preferredTime: preferredTimeInputSchema.optional(), confirmed: z.literal(true), website: z.literal('') }).strict()
export const websiteSessionResultSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), businessName: text(120), greeting: text(600), expiresAt: z.string().datetime(), turn: z.literal(0), feedbackEnabled: z.literal(true).optional(), callbackHours: callbackCalendarSchema.optional() }).strict()
export const websiteMessageResultSchema = z.object({ reply: text(600), turn: z.number().int().min(1).max(WEBSITE_SESSION_TURNS), canMessage: z.boolean() }).strict()
export const websiteCallbackResultSchema = z.object({ received: z.literal(true) }).strict()
export const websiteCallbackQuerySchema = z.object({ status: z.enum(['pending', 'reviewed', 'dismissed', 'all']).default('pending'), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict()
export const websiteCallbackReviewSchema = z.object({ action: z.enum(['review', 'dismiss']), expectedUpdatedAt: z.string().datetime() }).strict()
export const websiteCallbackRecordSchema = z.object({ id: z.string().uuid(), fullName: text(120), phone: phoneSchema, reason: text(1000), siteOrigin: websiteOriginSchema, status: z.enum(['pending', 'reviewed', 'dismissed']), consentedAt: z.string().datetime(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), preferredTime: preferredTimeSchema.optional() }).strict()
export const websiteCallbackListSchema = z.object({ callbacks: z.array(websiteCallbackRecordSchema).max(20), page: z.number().int().positive(), pageSize: z.literal(20), hasMore: z.boolean() }).strict()
export type WebsiteReceptionistAdminData = z.infer<typeof websiteAdminSchema>
export type WebsiteReceptionistSettings = z.infer<typeof websiteSettingsSchema>
export type WebsiteSessionResult = z.infer<typeof websiteSessionResultSchema>
export type WebsiteMessageResult = z.infer<typeof websiteMessageResultSchema>
export type WebsiteCallbackRecord = z.infer<typeof websiteCallbackRecordSchema>
export type WebsiteCallbackList = z.infer<typeof websiteCallbackListSchema>
export interface WebsiteRequestContext { ip: string; origin: string }
export interface WebsiteEmbedData { publicId: string; siteOrigin: string; allowedOrigins: string[]; businessName: string }
