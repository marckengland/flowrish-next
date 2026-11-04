import { expect, test, type Page } from '@playwright/test'
import { setupFixture } from '../src/components/settings/receptionist-setup-fixture.test-data'
import {
  pilotFixture,
  issuedPilotFixture,
  syntheticPilotToken,
} from '../src/components/admin/pilot-fixture.test-data'

test.use({
  storageState: { cookies: [], origins: [] },
  serviceWorkers: 'block',
})
async function mockPilot(page: Page, baseURL: string) {
  const state = {
    signedIn: false,
    sessionCleared: false,
    unavailable: false,
    joined: false,
    uncertain: false,
    staffUncertain: false,
    issued: false,
    revoked: false,
    generation: 0,
    writes: [] as string[],
    unexpected: [] as string[],
  }
  const origin = new URL(baseURL).origin
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (value: string) => {
          ;(window as unknown as { copied: string }).copied = value
        },
      },
    })
  })
  await page.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      method = req.method()
    const reply = (data: unknown) => route.fulfill({ json: { data } })
    if (url.origin !== origin || /receptionist-widget/.test(url.pathname)) {
      state.unexpected.push(url.pathname)
      await route.fulfill({ status: 503, json: {} })
      return
    }
    if (url.pathname.startsWith('/api/')) {
      const path = url.pathname
      if (method !== 'GET') state.writes.push(path)
      if (path === '/api/pilot/session' && method === 'DELETE') {
        state.sessionCleared = true
        await reply({ cleared: true })
        return
      }
      if (path === '/api/admin/receptionist/setup' && method === 'GET') {
        expect(state.sessionCleared).toBe(true)
        const setup = setupFixture()
        await reply({
          ...setup,
          business: {
            ...setup.business,
            saved: false,
            values: {
              ...setup.business.values,
              businessName: 'Sample business',
            },
          },
          website: {
            ...setup.website,
            settings: null,
            hasSavedBusiness: false,
            hasOrganizationAi: false,
            approvedDocuments: 0,
          },
          knowledge: {
            total: 0,
            published: 0,
            approved: 0,
            approvedCategories: [],
            sample: null,
          },
          readyToEnable: false,
        })
        return
      }
      if (path === '/api/pilot/session') {
        expect(req.postDataJSON()).toEqual({ token: syntheticPilotToken })
        await reply({ received: true })
        return
      }
      if (path === '/api/pilot/status') {
        await reply(
          state.unavailable
            ? { state: 'unavailable' }
            : state.joined
              ? {
                  state: 'joined',
                  organizationName: 'Sample business',
                  continueHref: '/receptionist/setup',
                }
              : state.signedIn
                ? { state: 'ready', expiresAt: '2026-11-11T01:00:00.000Z' }
                : { state: 'sign_in' },
        )
        return
      }
      if (path === '/api/pilot/accept') {
        expect(req.postDataJSON()).toEqual({
          name: 'Sample business',
          slug: 'sample-business',
          confirmed: true,
        })
        state.joined = true
        if (state.uncertain) await route.abort('failed')
        else
          await reply({
            state: 'joined',
            organizationName: 'Sample business',
            continueHref: '/receptionist/setup',
          })
        return
      }
      if (path === '/api/staff/waitlist') {
        await reply({
          entries: [pilotFixture().entry],
          page: 1,
          hasNext: false,
          canHandoff: true,
        })
        return
      }
      if (path.endsWith('/pilot/preview')) {
        await reply({
          version: 'a'.repeat(64),
          email: 'jamie@example.test',
          expiresInDays: 7,
        })
        return
      }
      const data = () =>
        state.issued
          ? {
              ...issuedPilotFixture(),
              invitation: {
                ...issuedPilotFixture().invitation,
                generation: state.generation,
                state: state.revoked ? 'revoked' : 'active',
              },
              entry: {
                ...issuedPilotFixture().entry,
                reviewVersion: state.generation * 2 - (state.revoked ? 0 : 1),
              },
            }
          : pilotFixture()
      if (path.endsWith('/pilot/revoke')) {
        state.revoked = true
        await reply(data())
        return
      }
      if (path.endsWith('/pilot') && method === 'GET') {
        await reply(data())
        return
      }
      if (path.endsWith('/pilot') && method === 'POST') {
        const replay = state.issued && !state.revoked
        if (!replay) {
          state.generation++
          state.issued = true
          state.revoked = false
        }
        if (state.staffUncertain && !replay) {
          await route.abort('failed')
          return
        }
        await reply({
          ...data(),
          link: replay ? null : `${origin}/pilot#invite=${syntheticPilotToken}`,
        })
        return
      }
      state.unexpected.push(`${method} ${path}`)
      await route.fulfill({ status: 503, json: {} })
      return
    }
    if (!['GET', 'HEAD'].includes(method)) {
      state.unexpected.push(method)
      await route.abort()
      return
    }
    await route.continue()
  })
  return state
}
async function approve(page: Page) {
  await page.getByRole('button', { name: 'Preview pilot invitation' }).click()
  await page
    .getByRole('checkbox', { name: 'I approve pilot access for this signup.' })
    .check()
  await page.getByRole('button', { name: 'Issue private pilot link' }).click()
}
for (const mobile of [false, true])
  test(`pilot onboarding approves and creates a separate workspace on ${mobile ? 'mobile' : 'desktop'} with mocks only`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1365, height: 900 },
    )
    const s = await mockPilot(page, baseURL!)
    await page.goto(`/pilot#invite=${syntheticPilotToken}`)
    const login = page.getByRole('link', {
      name: 'Sign in with the invited email',
    })
    await expect(login).toBeVisible()
    expect(new URL(page.url()).hash).toBe('')
    expect(
      await page.evaluate(() => [
        ...Object.keys(localStorage),
        ...Object.keys(sessionStorage),
      ]),
    ).toEqual([])
    expect(s.writes).toEqual(['/api/pilot/session'])
    await login.click()
    await expect(page).toHaveURL(/\/login\?next=\/pilot$/)
    s.signedIn = true
    await page.getByRole('link', { name: 'Return to pilot' }).click()
    await page
      .getByRole('textbox', { name: 'Business name' })
      .fill('Sample business')
    await page
      .getByRole('textbox', { name: 'Workspace identifier' })
      .fill('sample-business')
    const create = page.getByRole('button', {
      name: 'Create my pilot workspace',
    })
    await expect(create).toBeDisabled()
    const consent = page.getByRole('checkbox')
    await consent.check()
    await page
      .getByRole('textbox', { name: 'Business name' })
      .fill('Sample business updated')
    await expect(consent).not.toBeChecked()
    await page
      .getByRole('textbox', { name: 'Business name' })
      .fill('Sample business')
    await consent.check()
    await create.click()
    await expect(
      page.getByRole('link', { name: 'Continue receptionist setup' }),
    ).toHaveAttribute('href', '/receptionist/setup')
    await page.getByRole('button', { name: 'Reload invitation status' }).click()
    await expect(
      page.getByRole('heading', { name: 'Your pilot workspace is ready' }),
    ).toBeVisible()
    expect(s.writes.filter((p) => p === '/api/pilot/accept')).toHaveLength(1)
    expect(s.unexpected).toEqual([])
    await page.screenshot({
      path: `test-results/rehearsal/pilot-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    })
    await page
      .getByRole('link', { name: 'Continue receptionist setup' })
      .click()
    await expect(page).toHaveURL(/\/receptionist\/setup$/)
    await expect(
      page.getByRole('heading', { name: 'Set up your business receptionist' }),
    ).toBeVisible()
    await expect(
      page.getByRole('textbox', { name: 'Business name', exact: true }),
    ).toHaveValue('Sample business')
    expect(s.sessionCleared).toBe(true)
    expect(s.writes.filter((p) => p === '/api/pilot/accept')).toHaveLength(1)
    expect(s.unexpected).toEqual([])
  })
test('pilot onboarding rejects unavailable links without creating a workspace', async ({
  page,
  baseURL,
}) => {
  const s = await mockPilot(page, baseURL!)
  s.unavailable = true
  await page.goto(`/pilot#invite=${syntheticPilotToken}`)
  await expect(
    page.getByText('This invitation is unavailable for this account.', {
      exact: false,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Business name' }),
  ).toHaveCount(0)
  expect(s.writes).toEqual(['/api/pilot/session'])
  expect(s.unexpected).toEqual([])
})
test('pilot onboarding recovers an uncertain creation from the receipt without another write', async ({
  page,
  baseURL,
}) => {
  const s = await mockPilot(page, baseURL!)
  s.signedIn = true
  s.uncertain = true
  await page.goto(`/pilot#invite=${syntheticPilotToken}`)
  await page
    .getByRole('textbox', { name: 'Business name' })
    .fill('Sample business')
  await page
    .getByRole('textbox', { name: 'Workspace identifier' })
    .fill('sample-business')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Create my pilot workspace' }).click()
  await expect(
    page.getByRole('alert', { name: 'Pilot setup error' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Reload invitation status' }).click()
  await expect(
    page.getByRole('heading', { name: 'Your pilot workspace is ready' }),
  ).toBeVisible()
  expect(s.writes.filter((p) => p === '/api/pilot/accept')).toHaveLength(1)
  expect(s.unexpected).toEqual([])
})
test('pilot onboarding staff explicitly copies, revokes and replaces an unused link', async ({
  page,
  baseURL,
}) => {
  const s = await mockPilot(page, baseURL!)
  await page.goto('/staff/waitlist')
  await page
    .getByRole('button', {
      name: 'Manage pilot invitation for jamie@example.test',
    })
    .click()
  expect(s.writes).toEqual([])
  await approve(page)
  await expect(
    page.getByRole('textbox', { name: 'Private pilot link' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Copy private link' }).click()
  expect(
    await page.evaluate(() => (window as unknown as { copied: string }).copied),
  ).toBe(`${new URL(baseURL!).origin}/pilot#invite=${syntheticPilotToken}`)
  await page
    .getByRole('checkbox', {
      name: 'I confirm revoking this unused invitation link.',
    })
    .check()
  await page.getByRole('button', { name: 'Revoke unused link' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Private pilot link' }),
  ).toHaveCount(0)
  await approve(page)
  expect(s.generation).toBe(2)
  expect(s.unexpected).toEqual([])
})
test('pilot onboarding staff retries uncertain issuance without rotating or recovering plaintext', async ({
  page,
  baseURL,
}) => {
  const s = await mockPilot(page, baseURL!)
  s.staffUncertain = true
  await page.goto('/staff/waitlist')
  await page
    .getByRole('button', {
      name: 'Manage pilot invitation for jamie@example.test',
    })
    .click()
  await approve(page)
  await expect(
    page.getByRole('alert', { name: 'Pilot invitation error' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Issue private pilot link' }).click()
  await expect(
    page.getByText('Flowrish cannot recover the private link', {
      exact: false,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Private pilot link' }),
  ).toHaveCount(0)
  expect(s.generation).toBe(1)
  expect(s.unexpected).toEqual([])
})
