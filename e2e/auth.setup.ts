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
  const redirectTo = `${baseURL}/auth/confirm?next=/dashboard`
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
    properties?: { action_link?: string; hashed_token?: string }
    action_link?: string
    hashed_token?: string
  }

  // Prefer the `hashed_token`: our own `/auth/confirm` route expects a
  // `token_hash` query param and calls `supabase.auth.verifyOtp(...)`,
  // which sets the session cookies on OUR domain. Driving that route
  // directly avoids Supabase's `/auth/v1/verify` redirect (which depends
  // on the project's redirect allow-list and, when it isn't matched,
  // silently lands on the site's home page with no session).
  const hashedToken =
    payload.properties?.hashed_token ?? payload.hashed_token
  const actionLink = payload.properties?.action_link ?? payload.action_link

  if (hashedToken) {
    const confirmUrl = new URL('/auth/confirm', baseURL)
    confirmUrl.searchParams.set('token_hash', hashedToken)
    confirmUrl.searchParams.set('type', 'magiclink')
    confirmUrl.searchParams.set('next', '/dashboard')
    await page.goto(confirmUrl.toString())
  } else if (actionLink) {
    await page.goto(actionLink)
  } else {
    throw new Error(
      `No hashed_token/action_link in generate_link response: ${JSON.stringify(payload)}`,
    )
  }

  // Land inside the app (dashboard or onboarding), never back on /login.
  await page.waitForURL(/\/(?!login)/, { timeout: 30_000 })
  await expect(page, 'magic link confirmation bounced back to /login').not.toHaveURL(
    /\/login/,
  )

  // Hard-assert a real session exists. Without this, a misconfigured
  // redirect can leave us on a public page with NO auth cookie while the
  // "not on /login" check above still passes — exactly the false-positive
  // that hid a broken login. A Supabase session cookie is named
  // `sb-<project-ref>-auth-token` (it may be chunked with a `.0`/`.1`
  // suffix), so match the prefix.
  const cookies = await page.context().cookies()
  const authCookie = cookies.find((c) => /^sb-.*-auth-token/.test(c.name))
  expect(
    authCookie,
    'No Supabase auth cookie after confirming the magic link. The test user '
      + 'likely does not exist in this Supabase project, or the confirm flow '
      + 'failed. Cookies seen: '
      + cookies.map((c) => c.name).join(', '),
  ).toBeTruthy()

  // Persist the storage state so the chromium project can reuse it.
  mkdirSync(path.dirname(STORAGE_STATE), { recursive: true })
  await page.context().storageState({ path: STORAGE_STATE })
})
