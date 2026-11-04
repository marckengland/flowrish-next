import { expect, test, type BrowserContext } from '@playwright/test'
test.use({
  storageState: { cookies: [], origins: [] },
  serviceWorkers: 'block',
})
const one = '11111111-1111-4111-8111-111111111111'
const two = '22222222-2222-4222-8222-222222222222'
async function mock(context: BrowserContext, baseURL: string) {
  const origin = new URL(baseURL).origin
  const state = {
    active: one,
    mode: 'ok',
    writes: [] as string[],
    unexpected: [] as string[],
    headers: [] as string[],
  }
  await context.addCookies([
    { name: 'mock_workspace', value: one, url: origin },
  ])
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname
    if (url.origin !== origin || /receptionist-widget/.test(path)) {
      state.unexpected.push(path)
      await route.abort()
      return
    }
    if (path === '/api/workspaces') {
      if (request.method() === 'GET') {
        await route.fulfill({
          json: {
            data: {
              workspaces: [
                { id: one, name: 'Practice Studio' },
                { id: two, name: 'Practice Clinic' },
              ],
            },
          },
        })
        return
      }
      state.writes.push(path)
      if (state.mode === 'forbidden') {
        await route.fulfill({
          status: 403,
          json: { error: { code: 'WORKSPACE_ACCESS_REVOKED' } },
        })
        return
      }
      state.active = request.postDataJSON().organizationId
      await context.addCookies([
        { name: 'mock_workspace', value: state.active, url: origin },
      ])
      if (state.mode === 'uncertain') {
        await route.abort('failed')
        return
      }
      await route.fulfill({ json: { data: { organizationId: state.active } } })
      return
    }
    if (path === '/api/mock/workspace-leads') {
      const header = request.headers()['x-flowrish-workspace']
      state.headers.push(header)
      if (header !== state.active) {
        await route.fulfill({
          status: 409,
          json: { error: { code: 'WORKSPACE_CHANGED' } },
        })
        return
      }
      await route.fulfill({
        json: {
          name: state.active === one ? 'Studio prospect' : 'Clinic prospect',
        },
      })
      return
    }
    if (
      path.startsWith('/api/') ||
      !['GET', 'HEAD'].includes(request.method())
    ) {
      state.unexpected.push(`${request.method()} ${path}`)
      await route.abort()
      return
    }
    await route.continue()
  })
  return state
}
for (const mobile of [false, true])
  test(`workspace switcher changes business and clears cached data on ${mobile ? 'mobile' : 'desktop'} with mocks only`, async ({
    context,
    page,
    baseURL,
  }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1365, height: 900 },
    )
    const state = await mock(context, baseURL!)
    await page.goto('/dashboard')
    await expect(
      page.getByText('Studio prospect', { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Business' })).toBeEnabled()
    await page.evaluate(() => {
      localStorage.setItem(
        'flowrish:leads:filters',
        '{"assigneeId":"old-user"}',
      )
      localStorage.setItem('flowrish:theme', 'dark')
      sessionStorage.setItem('airish:active-conversation', 'old-thread')
    })
    await page.getByRole('combobox', { name: 'Business' }).selectOption(two)
    await expect(
      page.getByRole('heading', { name: 'Practice Clinic' }),
    ).toBeVisible()
    await expect(
      page.getByText('Clinic prospect', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Studio prospect', { exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Create lead' })).toHaveCount(
      0,
    )
    expect(
      await page.evaluate(() => ({
        filters: localStorage.getItem('flowrish:leads:filters'),
        thread: sessionStorage.getItem('airish:active-conversation'),
        theme: localStorage.getItem('flowrish:theme'),
      })),
    ).toEqual({ filters: null, thread: null, theme: 'dark' })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect(state.writes).toEqual(['/api/workspaces'])
    expect(state.unexpected).toEqual([])
    expect(state.headers).toContain(one)
    expect(state.headers).toContain(two)
    await page.screenshot({
      path: `test-results/rehearsal/workspace-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    })
  })
test('workspace switcher rejects stale-tab work before another write', async ({
  context,
  page,
  baseURL,
}) => {
  const state = await mock(context, baseURL!)
  await page.goto('/dashboard')
  await expect(page.getByText('Studio prospect', { exact: true })).toBeVisible()
  state.active = two
  await context.addCookies([
    { name: 'mock_workspace', value: two, url: baseURL! },
  ])
  await page.getByRole('button', { name: 'Refresh prospects' }).click()
  await expect(page).toHaveURL(/\/workspaces$/)
  await expect(
    page.getByRole('heading', { name: 'Choose your business' }),
  ).toBeVisible()
  expect(state.writes).toEqual([])
  expect(state.unexpected).toEqual([])
})
test('workspace switcher reloads other tabs after an explicit selection', async ({
  context,
  page,
  baseURL,
}) => {
  const state = await mock(context, baseURL!)
  const other = await context.newPage()
  await page.goto('/dashboard')
  await other.goto('/dashboard')
  await expect(
    other.getByText('Studio prospect', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Business' })).toBeEnabled()
  await page.getByRole('combobox', { name: 'Business' }).selectOption(two)
  await expect(
    page.getByRole('heading', { name: 'Practice Clinic' }),
  ).toBeVisible()
  await expect(other).toHaveURL(/\/workspaces$/)
  await expect(other.getByText('Studio prospect', { exact: true })).toHaveCount(
    0,
  )
  expect(state.writes).toEqual(['/api/workspaces'])
  expect(state.unexpected).toEqual([])
})
for (const mode of ['forbidden', 'uncertain'])
  test(`workspace switcher recovers a ${mode} selection without repeating its write`, async ({
    context,
    page,
    baseURL,
  }) => {
    const state = await mock(context, baseURL!)
    state.mode = mode
    await page.goto('/dashboard')
    await expect(page.getByRole('combobox', { name: 'Business' })).toBeEnabled()
    await page.getByRole('combobox', { name: 'Business' }).selectOption(two)
    await expect(page).toHaveURL(/\/workspaces\?switch=uncertain$/)
    await expect(
      page.getByRole('heading', { name: 'Choose your business' }),
    ).toBeVisible()
    expect(state.writes).toEqual(['/api/workspaces'])
    expect(state.unexpected).toEqual([])
  })
