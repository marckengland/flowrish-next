import { expect, test, type Page } from '@playwright/test'
import { coreIds, coreLead, coreTask } from './rehearsal-app/core-fixtures'
test.use({
  storageState: { cookies: [], origins: [] },
  serviceWorkers: 'block',
})
async function mockCore(page: Page, baseURL: string) {
  const state = {
    leadMode: 'normal',
    taskMode: 'normal',
    followMode: 'normal',
    failCreate: false,
    heldSearch: null as null | { started: () => void; released: Promise<void> },
    writes: [] as Array<{ path: string; body: Record<string, unknown> }>,
    unexpected: [] as string[],
    tasks: [coreTask()],
    approved: false,
  }
  const origin = new URL(baseURL).origin
  await page.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      method = req.method()
    const reply = (data: unknown) => route.fulfill({ json: { data } })
    if (url.origin !== origin || /receptionist-widget/.test(path)) {
      state.unexpected.push(`${method} ${path}`)
      await route.abort()
      return
    }
    if (path.startsWith('/api/')) {
      if (method !== 'GET')
        state.writes.push({ path, body: req.postDataJSON() })
      if (path === '/api/email/sync' && method === 'GET') {
        await route.fulfill({
          json: { data: [], capabilities: { canWrite: false } },
        })
        return
      }
      if (path === '/api/leads' && method === 'GET') {
        if (state.leadMode === 'error') {
          await route.fulfill({
            status: 503,
            json: { error: { message: 'Synthetic leads unavailable' } },
          })
          return
        }
        if (
          state.heldSearch &&
          url.searchParams.get('search') === 'Another missing name'
        ) {
          state.heldSearch.started()
          await state.heldSearch.released
        }
        const search = url.searchParams.get('search') ?? ''
        const rows =
          state.leadMode === 'empty' ||
          (search &&
            !'Practice Prospect'.toLowerCase().includes(search.toLowerCase()))
            ? []
            : [coreLead()]
        await route.fulfill({
          json: {
            data: rows,
            pagination: {
              page: 1,
              pageSize: 20,
              total: rows.length,
              totalPages: rows.length ? 1 : 0,
            },
          },
        })
        return
      }
      if (path === '/api/mock/core/leads' && method === 'POST') {
        if (state.failCreate) {
          await route.fulfill({
            json: { error: 'Synthetic lead validation failure' },
          })
          return
        }
        await reply({ id: coreIds.lead })
        return
      }
      if (path === '/api/mock/core/tasks' && method === 'POST') {
        const body = req.postDataJSON()
        state.tasks.push({
          ...coreTask(),
          id: '66666666-6666-4666-8666-666666666666',
          title: String(body.title),
          priority: body.priority,
          dueDate: new Date(String(body.dueDate)).toISOString(),
          isOverdue: false,
        })
        await reply({ id: state.tasks.at(-1)!.id })
        return
      }
      if (path === '/api/tasks' && method === 'GET') {
        if (state.taskMode === 'error') {
          await route.fulfill({
            status: 403,
            json: { error: { message: 'Synthetic task access denied' } },
          })
          return
        }
        await reply(state.taskMode === 'empty' ? [] : state.tasks)
        return
      }
      if (path.startsWith('/api/tasks/') && method === 'PATCH') {
        const id = path.split('/').at(-1)!,
          task = state.tasks.find((row) => row.id === id)!
        task.isComplete = true
        task.completedAt = new Date().toISOString()
        await reply(task)
        return
      }
      if (path === '/api/follow-ups' && method === 'GET') {
        if (state.followMode === 'error') {
          await route.fulfill({
            status: 403,
            json: { error: { message: 'Synthetic follow-up access denied' } },
          })
          return
        }
        await reply(
          state.followMode === 'empty'
            ? []
            : [
                {
                  id: 'practice-follow-up',
                  sourceType: 'EMAIL',
                  sourceText: 'Please call about the practice proposal.',
                  title: 'Review practice reply',
                  description: 'Review this synthetic follow-up.',
                  draftSubject: 'Practice reply',
                  draftBody: 'Thank you for the practice enquiry.',
                  status: state.approved ? 'APPROVED' : 'PENDING',
                  taskId: state.approved ? coreIds.task : null,
                  lead: {
                    id: coreIds.lead,
                    firstName: 'Practice',
                    lastName: 'Prospect',
                    email: 'practice@example.test',
                  },
                  createdAt: '2026-11-04T00:00:00.000Z',
                },
              ],
        )
        return
      }
      if (path === '/api/follow-ups/practice-follow-up' && method === 'PATCH') {
        state.approved = true
        await reply({
          id: 'practice-follow-up',
          ...req.postDataJSON(),
          status: 'APPROVED',
          taskId: coreIds.task,
          lead: {
            id: coreIds.lead,
            firstName: 'Practice',
            lastName: 'Prospect',
            email: 'practice@example.test',
          },
        })
        return
      }
      state.unexpected.push(`${method} ${path}`)
      await route.fulfill({ status: 503, json: {} })
      return
    }
    if (!['GET', 'HEAD'].includes(method)) {
      state.unexpected.push(`${method} ${path}`)
      await route.abort()
      return
    }
    await route.continue()
  })
  return state
}
for (const mobile of [false, true])
  test(`core audit follows dashboard, lead creation, tasks and follow-up approval on ${mobile ? 'mobile' : 'desktop'} with mock writes`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1365, height: 900 },
    )
    const s = await mockCore(page, baseURL!)
    await page.goto('/dashboard')
    await expect(
      page.getByRole('heading', { name: 'Dashboard', exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: `test-results/rehearsal/core-${mobile ? 'mobile' : 'desktop'}-dashboard.png`,
      fullPage: true,
    })
    await page.getByRole('tab', { name: 'Deal Health', exact: true }).click()
    await expect(
      page
        .getByRole('tabpanel', { name: 'Deal Health', exact: true })
        .getByRole('link', { name: 'Practice Prospect', exact: true }),
    ).toBeVisible()
    await page
      .getByRole('navigation', { name: 'Core workflow' })
      .getByRole('link', { name: 'Leads', exact: true })
      .click()
    await expect(page).toHaveURL(/\/leads$/)
    await expect(
      page.getByRole('heading', { name: 'Leads', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Open Practice Prospect' }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: `test-results/rehearsal/core-${mobile ? 'mobile' : 'desktop'}-leads.png`,
      fullPage: true,
    })
    await page.getByRole('link', { name: 'Open Practice Prospect' }).click()
    await expect(
      page.getByRole('region', { name: 'Lead details' }),
    ).toBeVisible()
    await page.goto('/leads/new')
    await expect(
      page.getByRole('heading', { name: 'New lead', exact: true }),
    ).toBeVisible()
    await expect(page.locator('input[name="firstName"]')).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.locator('input[name="firstName"]').fill('Practice')
    await page.locator('input[name="lastName"]').fill('Prospect')
    await page.locator('input[name="email"]').fill('practice@example.test')
    await page.getByRole('button', { name: 'Create lead', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/leads/${coreIds.lead}$`))
    await expect(
      page.getByRole('region', { name: 'Lead details' }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.getByRole('link', { name: 'Open task queue' }).click()
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(
      page.getByRole('heading', { name: 'Tasks', exact: true }),
    ).toBeVisible()
    await expect(page.locator('input[name="title"]')).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.locator('input[name="title"]').fill('Call practice prospect')
    await page.locator('input[name="dueDate"]').fill('2026-11-05T09:00')
    await page.getByRole('radio', { name: 'High', exact: true }).click()
    await page.getByRole('button', { name: 'Create Task', exact: true }).click()
    const task = page.getByRole('link', {
      name: 'Open task Call practice prospect',
      exact: true,
    })
    await expect(task).toBeVisible()
    await page
      .getByRole('button', {
        name: 'Mark "Call practice prospect" complete',
        exact: true,
      })
      .click()
    await expect(
      page.getByRole('button', {
        name: 'Mark "Call practice prospect" complete',
        exact: true,
      }),
    ).toHaveCount(0)
    await page.goto('/follow-ups')
    await expect(
      page.getByRole('textbox', { name: 'Task title', exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page
      .getByRole('textbox', { name: 'Task title', exact: true })
      .fill('Review approved practice follow-up')
    await page
      .getByRole('button', { name: 'Approve task', exact: true })
      .click()
    await expect(
      page.getByRole('link', { name: 'Open task', exact: true }),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Open task', exact: true }).click()
    await expect(
      page.getByRole('heading', {
        name: 'Review practice proposal',
        exact: true,
      }),
    ).toBeVisible()
    expect(s.writes.map((row) => row.path)).toEqual([
      '/api/mock/core/leads',
      '/api/mock/core/tasks',
      '/api/tasks/66666666-6666-4666-8666-666666666666',
      '/api/follow-ups/practice-follow-up',
    ])
    expect(s.writes[1].body.priority).toBe('HIGH')
    expect(s.unexpected).toEqual([])
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: `test-results/rehearsal/core-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    })
  })
test('core audit restores saved filters and distinguishes loading, empty and failed lead results', async ({
  page,
  baseURL,
}) => {
  const s = await mockCore(page, baseURL!)
  await page.addInitScript(() =>
    localStorage.setItem(
      'flowrish:leads:filters',
      JSON.stringify({ search: 'No match' }),
    ),
  )
  await page.goto('/leads')
  await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue(
    'No match',
  )
  await expect(
    page.getByText('No leads match the current filters', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Open Practice Prospect' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear all filters' }).click()
  await expect(
    page.getByRole('link', { name: 'Open Practice Prospect' }),
  ).toBeVisible()
  let releaseSearch!: () => void
  let searchStarted!: () => void
  const started = new Promise<void>((resolve) => {
    searchStarted = resolve
  })
  s.heldSearch = {
    started: searchStarted,
    released: new Promise<void>((resolve) => {
      releaseSearch = resolve
    }),
  }
  try {
    await page
      .getByRole('searchbox', { name: 'Search' })
      .fill('Another missing name')
    await started
    await expect(
      page.getByText('Loading leads…', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Open Practice Prospect' }),
    ).toHaveCount(0)
  } finally {
    releaseSearch()
    s.heldSearch = null
  }
  await expect(
    page.getByText('No leads match the current filters', { exact: true }),
  ).toBeVisible()
  s.leadMode = 'error'
  await page.getByRole('searchbox', { name: 'Search' }).fill('Unavailable')
  await expect(page.getByText(/Couldn.t load leads/)).toBeVisible()
  expect(s.writes).toEqual([])
  expect(s.unexpected).toEqual([])
})
test('core audit keeps read-only lead, task and follow-up controls unavailable', async ({
  page,
  baseURL,
}) => {
  const s = await mockCore(page, baseURL!)
  await page.goto(`/leads/${coreIds.lead}?readonly=true`)
  await expect(page.getByRole('region', { name: 'Lead details' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Edit', exact: true }),
  ).toHaveCount(0)
  await page.goto('/tasks?readonly=true')
  await expect(
    page.getByText("You don't have permission to create tasks."),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Mark.*complete/ }),
  ).toHaveCount(0)
  await page.goto('/follow-ups/readonly')
  await expect(
    page.getByText('Review practice reply', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Approve task', exact: true }),
  ).toHaveCount(0)
  expect(s.writes).toEqual([])
  expect(s.unexpected).toEqual([])
})
test('core audit shows validation, denied task access and empty follow-ups without side effects', async ({
  page,
  baseURL,
}) => {
  const s = await mockCore(page, baseURL!)
  s.failCreate = true
  await page.goto('/leads/new')
  await page.locator('input[name="firstName"]').fill('Practice')
  await page.locator('input[name="lastName"]').fill('Prospect')
  await page.getByRole('button', { name: 'Create lead', exact: true }).click()
  await expect(
    page.getByText('Synthetic lead validation failure', { exact: true }),
  ).toBeVisible()
  s.taskMode = 'error'
  await page.goto('/tasks?readonly=true')
  await expect(page.getByText(/Couldn.t load tasks/)).toBeVisible()
  await expect(page.getByRole('link', { name: /Open task/ })).toHaveCount(0)
  s.followMode = 'empty'
  await page.goto('/follow-ups')
  await expect(page.getByText(/No pending follow-ups/i)).toBeVisible()
  expect(s.writes).toHaveLength(1)
  expect(s.unexpected).toEqual([])
})
