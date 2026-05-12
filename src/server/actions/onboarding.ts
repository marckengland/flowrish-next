'use server'

import { redirect } from 'next/navigation'
import { requireSession } from '@/server/auth/session'
import { createOrganization, acceptInvite } from '@/server/services/organizations'
import { z } from 'zod'

/**
 * Server Actions for the onboarding flow.
 * New users either create an organization or join one via invite code.
 *
 * Validates: Requirements 2.3
 */

const createOrgSchema = z.object({
  name: z
    .string()
    .min(1, 'Organization name is required')
    .max(100, 'Organization name must be 100 characters or less'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(50, 'Slug must be 50 characters or less')
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Slug must be lowercase letters, numbers, and hyphens only (no leading/trailing hyphens)',
    ),
})

const joinOrgSchema = z.object({
  inviteCode: z.string().min(1, 'Invite code is required'),
})

/**
 * Creates a new organization for the authenticated user.
 * On success, redirects to the dashboard.
 */
export async function createOrg(formData: FormData) {
  const session = await requireSession()

  const parsed = createOrgSchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
  })

  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? 'Invalid input'
    return { error: firstError }
  }

  const { name, slug } = parsed.data

  try {
    await createOrganization(name, slug, session.dbUser.id)
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to create organization. Please try again.' }
  }

  redirect('/')
}

/**
 * Joins an existing organization via invite code (invite ID).
 * On success, redirects to the dashboard.
 */
export async function joinOrg(formData: FormData) {
  const session = await requireSession()

  const parsed = joinOrgSchema.safeParse({
    inviteCode: formData.get('inviteCode'),
  })

  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? 'Invalid input'
    return { error: firstError }
  }

  const { inviteCode } = parsed.data

  try {
    await acceptInvite(inviteCode, session.dbUser.id)
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to accept invite. Please check the code and try again.' }
  }

  redirect('/')
}
