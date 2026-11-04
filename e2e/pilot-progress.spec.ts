import { expect, test, type Page } from '@playwright/test'
import { sampleWaitlistEntry } from '../src/components/admin/waitlist-fixture.test-data'
test.use({
  storageState: { cookies: [], origins: [] },
  serviceWorkers: 'block',
})
async function mockedProgress(page: Page, baseURL: string) {
  const state = { phase: 'missing', reads: 0, unexpected: [] as string[] }
  const origin = new URL(baseURL).origin
  await page.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      method = req.method()
    if (
      url.origin !== origin ||
      !['GET', 'HEAD'].includes(method) ||
      /receptionist-widget/.test(url.pathname)
    ) {
      state.unexpected.push(`${method} ${url.pathname}`)
      await route.abort()
      return
    }
    if (url.pathname === '/api/staff/waitlist') {
      await route.fulfill({
        json: {
          data: {
            entries: [{ ...sampleWaitlistEntry(), status: 'joined' }],
            page: 1,
            hasNext: false,
            canHandoff: true,
          },
        },
      })
      return
    }
    if (url.pathname.endsWith('/pilot/progress')) {
      state.reads++
      if (state.phase === 'denied') {
        await route.fulfill({
          status: 403,
          json: { error: { message: 'Flowrish staff access is required.' } },
        })
        return
      }
      if (state.phase === 'error') {
        await route.fulfill({
          status: 503,
          json: { error: { message: 'Unavailable' } },
        })
        return
      }
      const complete = state.phase !== 'missing'
      await route.fulfill({
        json: {
          data: {
            state: 'joined',
            checkedAt: '2026-11-04T03:00:00.000Z',
            businessSaved: true,
            knowledge: { services: true, pricing: complete, faqs: complete },
            aiConfigured: complete,
            websiteSaved: complete,
            widgetEnabled: false,
            rehearsal:
              state.phase === 'stale'
                ? 'stale'
                : complete
                  ? 'passed'
                  : 'not_saved',
            nextStep:
              state.phase === 'stale'
                ? 'rehearsal'
                : complete
                  ? 'manual_review'
                  : 'knowledge',
          },
        },
      })
      return
    }
    if (url.pathname.startsWith('/api/')) {
      state.unexpected.push(url.pathname)
      await route.fulfill({ status: 503, json: {} })
      return
    }
    await route.continue()
  })
  return state
}
for (const mobile of [false, true])
  test(`pilot progress checks saved milestones and stale reviews on ${mobile ? 'mobile' : 'desktop'} without writes`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1365, height: 900 },
    )
    const s = await mockedProgress(page, baseURL!)
    await page.goto('/staff/waitlist')
    const check = page.getByRole('button', {
      name: 'Check pilot setup progress for jamie@example.test',
    })
    await expect(check).toBeEnabled()
    expect(s.reads).toBe(0)
    await check.click()
    await expect(
      page.getByText(
        'Publish and approve services, pricing guidance, and FAQs in the Library.',
      ),
    ).toBeVisible()
    await expect(page.getByText('Widget off', { exact: true })).toBeVisible()
    s.phase = 'stale'
    await page.getByRole('button', { name: 'Refresh pilot progress' }).click()
    await expect(
      page.getByText('Setup changed — repeat rehearsal', { exact: true }),
    ).toBeVisible()
    s.phase = 'error'
    await page.getByRole('button', { name: 'Refresh pilot progress' }).click()
    await expect(
      page.getByRole('alert', { name: 'Pilot progress error' }),
    ).toBeVisible()
    await expect(page.getByText('Widget off', { exact: true })).toHaveCount(0)
    s.phase = 'ready'
    await page.getByRole('button', { name: 'Refresh pilot progress' }).click()
    await expect(
      page.getByText('Saved rehearsal marked passed', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(
        'Review the pilot manually with the business before any launch.',
      ),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: `test-results/rehearsal/pilot-progress-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Close pilot progress' }).click()
    await expect(
      page.getByRole('heading', { name: 'Pilot setup progress' }),
    ).toHaveCount(0)
    expect(s.reads).toBe(4)
    expect(s.unexpected).toEqual([])
  })
test('pilot progress hides the entire prospect inbox when staff access is revoked', async ({
  page,
  baseURL,
}) => {
  const s = await mockedProgress(page, baseURL!)
  await page.goto('/staff/waitlist')
  await page
    .getByRole('button', {
      name: 'Check pilot setup progress for jamie@example.test',
    })
    .click()
  await expect(page.getByText('Widget off', { exact: true })).toBeVisible()
  s.phase = 'denied'
  await page.getByRole('button', { name: 'Refresh pilot progress' }).click()
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Flowrish staff access is required.' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'jamie@example.test' }),
  ).toHaveCount(0)
  await expect(page.getByText('Widget off', { exact: true })).toHaveCount(0)
  expect(s.reads).toBe(2)
  expect(s.unexpected).toEqual([])
})
