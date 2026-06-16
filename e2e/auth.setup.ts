import { test as setup, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Authentication setup project.
 *
 * The app uses passwordless auth (magic link / Google OAuth), so signing
 * in via the UI requires an email round-trip that we can't observe from
 * a test. Instead we use Supabase's admin API to mint a magic link
 * directly for a known test user, then navigate to it. The app's
 * `/auth/confirm` route exchanges the token for a session and the
 * Supabase cookies land on the browser context, which Playwright then
 * persists to `storageState` for the smoke tests to reuse.
 */

const STORAGE_STATE = path.resolve(__dirname, '.auth/user.json')

setup('authenticate as test user', async ({ page, request, baseURL }) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY
  const testEmail = process.env.E2E_TEST_USER_EMAIL

  if (!supabaseUrl || !serviceRoleKey || !testEmail) {
    throw new Error(
      'Missing required env vars for E2E auth: NEXT_PUBLIC_SUPABASE_URL, ' +
        'SUPABASE_SECRET_KEY, E2E_TEST_USER_EMAIL. Set them in your .env ' +
        'or shell before running `npm run test:e2e`.',
    )
  }

  // Ask Supabase Admin to generate a magic link without sending the email.
  // The response includes `properties.action_link` — a fully-qualified URL
  // we can navigate to directly. Docs: https://supabase.com/docs/reference/javascript/auth-admin-generatelink
  const adminUrl = `${supabaseUrl}/auth/v1/admin/generate_link`
  const redirectTo = `${baseURL}/auth/confirm?next=/`
  const response = await request.post(adminUrl, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    data: {
      type: 'magiclink',
      email: testEmail,
      options: { redirect_to: redirectTo },
    },
  })

  if (!response.ok()) {
    const body = await response.text()
    throw new Error(
      `Supabase admin generate_link failed (${response.status()}): ${body}`,
    )
  }

  const payload = (await response.json()) as {
    properties?: { action_link?: string }
    action_link?: string
  }
  const actionLink = payload.properties?.action_link ?? payload.action_link
  if (!actionLink) {
    throw new Error(
      `No action_link in Supabase generate_link response: ${JSON.stringify(payload)}`,
    )
  }

  // Follow the magic link. The /auth/confirm route handler runs server-
  // side, sets cookies, and 302s us back to `next` (default '/').
  await page.goto(actionLink)

  // We should land somewhere inside the dashboard once auth completes.
  // Onboarding is also acceptable (first-time user).
  await page.waitForURL(/\/(?!login)/, { timeout: 30_000 })
  await expect(page).not.toHaveURL(/\/login/)

  // Persist the storage state so chromium project can reuse it.
  mkdirSync(path.dirname(STORAGE_STATE), { recursive: true })
  await page.context().storageState({ path: STORAGE_STATE })
})
