import { z } from 'zod'
import { sanitizedString, nullableSanitizedString } from './common'

/**
 * Lead status enum values.
 */
export const leadStatusEnum = z.enum([
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'UNQUALIFIED',
  'NURTURING',
])

/**
 * Lead tier enum values.
 */
export const leadTierEnum = z.enum(['TIER_1', 'TIER_2', 'TIER_3'])

/**
 * Schema for creating a new lead.
 * Required fields: firstName, lastName, stageId
 */
export const leadCreateSchema = z.object({
  firstName: sanitizedString.pipe(z.string().min(1, 'First name is required')),
  lastName: sanitizedString.pipe(z.string().min(1, 'Last name is required')),
  stageId: z.string().uuid('Invalid stage ID'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  altEmail: z.string().email('Invalid alt email').optional().or(z.literal('')),
  phone: nullableSanitizedString,
  title: nullableSanitizedString,
  description: nullableSanitizedString,
  dealValue: z.coerce.number().min(0, 'Deal value must be non-negative').optional(),
  currency: sanitizedString.pipe(z.string().length(3)).default('USD'),
  score: z.coerce.number().int().min(0).max(100).optional(),
  leadStatus: leadStatusEnum.optional(),
  tier: leadTierEnum.optional(),
  linkedinUrl: z.string().url('Invalid LinkedIn URL').optional().or(z.literal('')),
  country: nullableSanitizedString,
  state: nullableSanitizedString,
  companyName: nullableSanitizedString,
  companyIndustry: nullableSanitizedString,
  companyWebsite: z.string().url('Invalid company website URL').optional().or(z.literal('')),
  companyLinkedinUrl: z.string().url('Invalid company LinkedIn URL').optional().or(z.literal('')),
})

export type LeadCreateInput = z.infer<typeof leadCreateSchema>

/**
 * Schema for updating an existing lead.
 * All fields are optional — only provided fields are updated.
 */
export const leadUpdateSchema = z.object({
  firstName: sanitizedString.pipe(z.string().min(1, 'First name is required')).optional(),
  lastName: sanitizedString.pipe(z.string().min(1, 'Last name is required')).optional(),
  stageId: z.string().uuid('Invalid stage ID').optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  altEmail: z.string().email('Invalid alt email').optional().or(z.literal('')),
  phone: nullableSanitizedString,
  title: nullableSanitizedString,
  description: nullableSanitizedString,
  dealValue: z.coerce.number().min(0, 'Deal value must be non-negative').optional(),
  currency: sanitizedString.pipe(z.string().length(3)).optional(),
  score: z.coerce.number().int().min(0).max(100).optional(),
  leadStatus: leadStatusEnum.optional(),
  tier: leadTierEnum.optional(),
  linkedinUrl: z.string().url('Invalid LinkedIn URL').optional().or(z.literal('')),
  country: nullableSanitizedString,
  state: nullableSanitizedString,
  companyName: nullableSanitizedString,
  companyIndustry: nullableSanitizedString,
  companyWebsite: z.string().url('Invalid company website URL').optional().or(z.literal('')),
  companyLinkedinUrl: z.string().url('Invalid company LinkedIn URL').optional().or(z.literal('')),
})

export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>
