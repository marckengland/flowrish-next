import { test, expect, type Page } from '@playwright/test'

/**
 * Dashboard smoke test.
 *
 * Walks every primary dashboard route as the authed test user and
 * asserts that:
 *   1. The page loads with HTTP 200 (not 404 / 500).
 *   2. The expected primary heading is present so we catch silent
 *      empty-page renders that still return 200.
 *   3. No client-side errors are logged to the console while loading.
 *
 * If a route relies on data that may or may not exist for the test
 * tenant (e.g. a specific lead/cadence id), it's covered by the row
 * click flows below — those skip when the table renders an empty state.
 */

interface RouteCheck {
  path: string
  /** Substring expected to appear in the rendered page heading. */
  heading: string | RegExp
}

const ROUTES: readonly RouteCheck[] = [
  { path: '/', heading: /Dashboard|Home|Pipeline/i },
  { path: '/leads', heading: 'Leads' },
  { path: '/leads/new', heading: 'New lead' },
  { path: '/contacts', heading: 'Contacts' },
  { path: '/companies', heading: 'Companies' },
  { path: '/cadences', heading: 'Cadences' },
  { path: '/tasks', heading: 'Tasks' },
  { path: '/pipeline', heading: 'Pipeline' },
  { path: '/forecast', heading: 'Forecast' },
  { path: '/rhythm', heading: 'Rhythm' },
  { path: '/csv', heading: /CSV|Import/i },
  { path: '/search', heading: 'Search' },
  { path: '/settings', heading: 'Settings' },
  { path: '/admin', heading: /Admin|Members/i },
]

for (const route of ROUTES) {
  test(`route ${route.path} loads and renders its heading`, async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page)

    const response = await page.goto(route.path)
    expect(response, `expected a response for ${route.path}`).not.toBeNull()
    expect(response!.status(), `${route.path} should not 404/500`).toBeLessThan(
      400,
    )

    // Heading sanity check — a top-level <h1> on the page (or a
    // permission-denied <h1> which is also valid for low-privilege test
    // users; both are non-error renders).
    const heading = page.getByRole('heading', { level: 1 }).first()
    await expect(heading).toBeVisible({ timeout: 15_000 })

    // We do a soft text assertion: the test user might be on a screen
    // saying "You don't have permission to view X" which is still a
    // healthy render. So we accept either the expected heading OR a
    // permission-denied heading mentioning the same noun.
    const headingText = (await heading.textContent())?.trim() ?? ''
    const matches =
      typeof route.heading === 'string'
        ? headingText.toLowerCase().includes(route.heading.toLowerCase())
        : route.heading.test(headingText)
    expect(
      matches,
      `expected heading on ${route.path} to match ${route.heading}, got "${headingText}"`,
    ).toBe(true)

    expect(
      consoleErrors,
      `expected no console errors on ${route.path}; got: ${consoleErrors.join(
        '\n',
      )}`,
    ).toEqual([])
  })
}

test.describe('row click navigation', () => {
  test('clicking a lead row opens the lead detail', async ({ page }) => {
    await page.goto('/leads')
    const firstRow = page
      .getByRole('link', { name: /^Open / })
      .first()
    if ((await firstRow.count()) === 0) {
      test.skip(true, 'No leads in the test tenant — nothing to click')
    }
    await firstRow.click()
    await expect(page).toHaveURL(/\/leads\/[^/]+$/)
    await expect(page.getByRole('link', { name: /Back to leads/i })).toBeVisible()
  })

  test('clicking a contact row opens the contact detail', async ({ page }) => {
    await page.goto('/contacts')
    const firstRow = page
      .getByRole('link', { name: /^Open / })
      .first()
    if ((await firstRow.count()) === 0) {
      test.skip(true, 'No contacts in the test tenant')
    }
    await firstRow.click()
    await expect(page).toHaveURL(/\/contacts\/[^/]+$/)
    await expect(
      page.getByRole('link', { name: /Back to contacts/i }),
    ).toBeVisible()
  })

  test('clicking a company row opens the company detail', async ({ page }) => {
    await page.goto('/companies')
    const firstRow = page
      .getByRole('link', { name: /^Open / })
      .first()
    if ((await firstRow.count()) === 0) {
      test.skip(true, 'No companies in the test tenant')
    }
    await firstRow.click()
    await expect(page).toHaveURL(/\/companies\/[^/]+$/)
  })

  test('clicking a cadence row opens the cadence detail', async ({ page }) => {
    await page.goto('/cadences')
    const firstRow = page
      .getByRole('link', { name: /^Open cadence/ })
      .first()
    if ((await firstRow.count()) === 0) {
      test.skip(true, 'No cadences in the test tenant')
    }
    await firstRow.click()
    await expect(page).toHaveURL(/\/cadences\/[^/]+$/)
    await expect(
      page.getByRole('link', { name: /Back to cadences/i }),
    ).toBeVisible()
  })

  test('clicking a task card opens the task detail', async ({ page }) => {
    await page.goto('/tasks')
    const firstCard = page
      .getByRole('link', { name: /^Open task/ })
      .first()
    if ((await firstCard.count()) === 0) {
      test.skip(true, 'No tasks in the test tenant')
    }
    await firstCard.click()
    await expect(page).toHaveURL(/\/tasks\/[^/]+$/)
    await expect(page.getByRole('link', { name: /Back to tasks/i })).toBeVisible()
  })
})

test.describe('primary CTA flows', () => {
  test('"New lead" CTA reaches the create form', async ({ page }) => {
    await page.goto('/leads')
    const cta = page.getByRole('link', { name: /New lead/i }).first()
    if ((await cta.count()) === 0) {
      test.skip(true, 'Test user lacks leads:write — no New lead button')
    }
    await cta.click()
    await expect(page).toHaveURL('/leads/new')
    await expect(
      page.getByRole('heading', { level: 1, name: /New lead/i }),
    ).toBeVisible()

    // Required fields render (sanity that the LeadForm mounted).
    await expect(page.locator('input[name="firstName"]')).toBeVisible()
    await expect(page.locator('input[name="lastName"]')).toBeVisible()
    await expect(page.locator('select[name="stageId"]')).toBeVisible()
  })
})

/**
 * Collects console errors and uncaught page errors so smoke tests fail
 * loudly when a route renders but logs a runtime exception.
 *
 * We filter out a couple of well-known warnings that are noisy but not
 * actionable (e.g. React DevTools install hint).
 */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (/Download the React DevTools/i.test(text)) return
    errors.push(text)
  })
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`)
  })
  return errors
}
