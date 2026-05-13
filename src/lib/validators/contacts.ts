import { z } from 'zod'
import { sanitizedString, nullableSanitizedString } from './common'

/**
 * Schema for creating a new contact.
 * Required fields: firstName, lastName
 *
 * Validates: Requirement 19.1
 */
export const contactCreateSchema = z.object({
  firstName: sanitizedString.pipe(z.string().min(1, 'First name is required')),
  lastName: sanitizedString.pipe(z.string().min(1, 'Last name is required')),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: nullableSanitizedString,
  jobTitle: nullableSanitizedString,
  linkedinUrl: z.string().url('Invalid LinkedIn URL').optional().or(z.literal('')),
  country: nullableSanitizedString,
  state: nullableSanitizedString,
  companyId: z.string().uuid('Invalid company ID').optional(),
})

export type ContactCreateInput = z.infer<typeof contactCreateSchema>

/**
 * Schema for creating a new company.
 * Required fields: name
 *
 * Validates: Requirement 19.3
 */
export const companyCreateSchema = z.object({
  name: sanitizedString.pipe(z.string().min(1, 'Company name is required')),
  industry: nullableSanitizedString,
  website: z.string().url('Invalid website URL').optional().or(z.literal('')),
})

export type CompanyCreateInput = z.infer<typeof companyCreateSchema>
