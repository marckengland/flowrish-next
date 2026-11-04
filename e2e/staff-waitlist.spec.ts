import { expect, test, type Page } from '@playwright/test'
import {
  sampleWaitlistEntry,
  sampleWaitlistOptions,
  sampleWaitlistPreview,
  sampleWaitlistReceipt,
  waitlistIds,
} from '../src/components/admin/waitlist-fixture.test-data'

test.use({
  storageState: { cookies: [], origins: [] },
  serviceWorkers: 'block',
})
async function mockedInbox(page: Page, baseURL: string, signedUp = true) {
  const state = {
    entry: sampleWaitlistEntry(),
    signedUp,
    allowed: true,
    uncertain: false,
    receipt: null as ReturnType<typeof sampleWaitlistReceipt> | null,
    leads: [] as Array<{ id: string; label: string }>,
    requests: [] as Array<{
      path: string
      method: string
      body: Record<string, unknown>
    }>,
    unexpected: [] as string[],
  }
  const origin = new URL(baseURL).origin,
    base = '/api/staff/waitlist',
    item = `${base}/${waitlistIds.entry}`
  await page.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method()
    const reply = async (data: unknown) =>
      route.fulfill({ status: 200, json: { data } })
    const forbidden = async () =>
      route.fulfill({
        status: 403,
        json: { error: { message: 'Flowrish staff access is required.' } },
      })
    if (
      url.origin !== origin ||
      /receptionist-widget(?:-frame)?\.js$/.test(url.pathname)
    ) {
      state.unexpected.push(`${method} ${url.pathname}`)
      await route.fulfill({ status: 503, json: {} })
      return
    }
    if (url.pathname === '/api/waitlist' && method === 'POST') {
      const body = request.postDataJSON()
      state.requests.push({ path: url.pathname, method, body })
      state.signedUp = true
      state.entry = {
        ...state.entry,
        email: body.email,
        name: body.name,
        source: body.source,
      }
      await reply({ success: true })
      return
    }
    if (url.pathname.startsWith(base)) {
      if (!state.allowed) {
        await forbidden()
        return
      }
      if (url.pathname === base && method === 'GET') {
        const reviewStatus = url.searchParams.get('reviewStatus') ?? 'all',
          page = Number(url.searchParams.get('page') ?? 1)
        await reply({
          entries:
            state.signedUp &&
            page === 1 &&
            (reviewStatus === 'all' ||
              reviewStatus === state.entry.reviewStatus)
              ? [state.entry]
              : [],
          page,
          hasNext: false,
          canHandoff: true,
        })
        return
      }
      if (url.pathname === item && method === 'PATCH') {
        const body = request.postDataJSON()
        state.requests.push({ path: url.pathname, method, body })
        state.entry = {
          ...state.entry,
          reviewStatus: body.reviewStatus,
          reviewVersion: state.entry.reviewVersion + 1,
        }
        await reply(state.entry)
        return
      }
      if (url.pathname === `${item}/handoff` && method === 'GET') {
        await reply({
          ...sampleWaitlistOptions(),
          entry: state.entry,
          receipt: state.receipt,
          leads: state.leads,
        })
        return
      }
      if (url.pathname === `${item}/handoff/preview` && method === 'POST') {
        const body = request.postDataJSON()
        state.requests.push({ path: url.pathname, method, body })
        const target = body.target
        await reply({
          ...sampleWaitlistPreview(),
          action: target.mode === 'new' ? 'create' : 'link',
          targetLabel:
            target.mode === 'new'
              ? `${target.firstName} ${target.lastName}`
              : state.leads.find((row) => row.id === target.leadId)?.label,
          ownerLabel: target.mode === 'new' ? 'Sample staff' : null,
          stageLabel: target.mode === 'new' ? 'Sales / New' : null,
        })
        return
      }
      if (url.pathname === `${item}/handoff` && method === 'POST') {
        const body = request.postDataJSON()
        state.requests.push({ path: url.pathname, method, body })
        state.receipt ??= {
          ...sampleWaitlistReceipt(),
          leadId:
            body.draft.target.mode === 'existing'
              ? body.draft.target.leadId
              : waitlistIds.lead,
          createdLead: body.draft.target.mode === 'new',
        }
        state.entry = {
          ...state.entry,
          reviewStatus: 'reviewed',
          reviewVersion: state.entry.reviewVersion + 1,
        }
        if (state.uncertain) await route.abort('failed')
        else await reply(state.receipt)
        return
      }
    }
    if (url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(method)) {
      state.unexpected.push(`${method} ${url.pathname}`)
      await route.fulfill({ status: 503, json: {} })
      return
    }
    await route.continue()
  })
  return state
}
const commits = (state: Awaited<ReturnType<typeof mockedInbox>>) =>
  state.requests.filter(
    (row) => row.method === 'POST' && row.path.endsWith('/handoff'),
  )
async function newLead(page: Page) {
  await page
    .getByRole('button', { name: 'Prepare CRM handoff for jamie@example.test' })
    .click()
  const mode = page.getByRole('radio', {
    name: 'Create a new lead',
    exact: true,
  })
  await expect(mode).toBeEnabled()
  await mode.check()
  await page
    .getByRole('combobox', { name: 'Lead owner', exact: true })
    .selectOption(waitlistIds.user)
  await page
    .getByRole('combobox', { name: 'Open stage', exact: true })
    .selectOption(waitlistIds.stage)
}
async function approve(page: Page) {
  await page
    .getByRole('button', { name: 'Preview CRM handoff', exact: true })
    .click()
  const consent = page.getByRole('checkbox', {
    name: 'I approve this CRM handoff.',
    exact: true,
  })
  await expect(consent).toBeEnabled()
  await expect(
    page.getByRole('button', { name: 'Confirm CRM handoff', exact: true }),
  ).toBeDisabled()
  await consent.check()
}

for (const mobile of [false, true]) {
  test(`staff waitlist follows demo attribution, review and explicit CRM approval on ${mobile ? 'mobile' : 'desktop'} with mock records only`, async ({
    page,
    baseURL,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    const state = await mockedInbox(page, baseURL!, false)
    await page.goto('/demo')
    await page
      .getByRole('link', { name: 'Join the waitlist', exact: true })
      .click()
    await expect(page).toHaveURL(/\/\?source=receptionist-demo#waitlist$/)
    await page.getByRole('textbox', { name: /name/i }).fill('Jamie Example')
    await page
      .getByRole('textbox', { name: /email/i })
      .fill('jamie@example.test')
    await page
      .getByRole('button', { name: 'Join the waitlist', exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText("You're on the list")
    expect(state.requests[0].body.source).toBe('public_demo')
    await page.goto('/staff/waitlist')
    await expect(
      page.getByText('Receptionist demo', { exact: true }),
    ).toBeVisible()
    const reviewed = page.getByRole('button', {
      name: 'Mark reviewed for jamie@example.test',
    })
    await expect(reviewed).toBeEnabled()
    await reviewed.click()
    await expect(page.getByRole('status')).toContainText(
      'Review status recorded',
    )
    expect(state.entry.status).toBe('pending')
    await newLead(page)
    expect(commits(state)).toHaveLength(0)
    await approve(page)
    await page
      .getByRole('textbox', { name: 'Lead first name', exact: true })
      .fill('Jamie corrected')
    await expect(
      page.getByRole('checkbox', {
        name: 'I approve this CRM handoff.',
        exact: true,
      }),
    ).toHaveCount(0)
    await approve(page)
    await page
      .getByRole('button', { name: 'Confirm CRM handoff', exact: true })
      .evaluate((button: HTMLButtonElement) => {
        button.click()
        button.click()
      })
    const receipt = page.getByRole('region', {
      name: 'CRM handoff receipt',
      exact: true,
    })
    await expect(receipt).toContainText('New lead created')
    await expect(
      receipt.getByRole('link', { name: 'Open approved lead', exact: true }),
    ).toHaveAttribute('href', `/leads/${waitlistIds.lead}`)
    expect(commits(state)).toHaveLength(1)
    expect(commits(state)[0].body).toMatchObject({
      confirmed: true,
      draft: { expectedVersion: 1, target: { firstName: 'Jamie corrected' } },
    })
    await expect(
      page.getByRole('button', { name: 'Confirm CRM handoff', exact: true }),
    ).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: `/tmp/flowrish-waitlist-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    })
    expect(state.unexpected).toEqual([])
  })
}
test('staff waitlist requires an explicit selection among existing matching leads', async ({
  page,
  baseURL,
}) => {
  const state = await mockedInbox(page, baseURL!)
  const second = '77777777-7777-4777-8777-777777777777'
  state.leads = [
    { id: waitlistIds.lead, label: 'Jamie first' },
    { id: second, label: 'Jamie second' },
  ]
  await page.goto('/staff/waitlist')
  const open = page.getByRole('button', {
    name: 'Prepare CRM handoff for jamie@example.test',
  })
  await expect(open).toBeEnabled()
  await open.click()
  const mode = page.getByRole('radio', {
    name: 'Link an existing matching lead',
    exact: true,
  })
  await expect(mode).toBeEnabled()
  await mode.check()
  const select = page.getByRole('combobox', {
    name: 'Matching active lead',
    exact: true,
  })
  await expect(select).toHaveValue('')
  await select.selectOption(second)
  await approve(page)
  await page
    .getByRole('button', { name: 'Confirm CRM handoff', exact: true })
    .click()
  await expect(
    page.getByRole('region', { name: 'CRM handoff receipt', exact: true }),
  ).toContainText('Existing lead linked')
  expect(commits(state)[0].body).toMatchObject({
    draft: { target: { mode: 'existing', leadId: second } },
  })
  expect(state.receipt?.createdLead).toBe(false)
  expect(state.unexpected).toEqual([])
})
test('staff waitlist hides prospects for ungranted access and clears them after revocation', async ({
  page,
  baseURL,
}) => {
  const state = await mockedInbox(page, baseURL!)
  state.allowed = false
  await page.goto('/staff/waitlist')
  await expect(
    page
      .getByRole('alert')
      .filter({
        hasText: /Flowrish staff access is required\.|Reload handoff/,
      }),
  ).toContainText('Flowrish staff access is required.')
  await expect(
    page.getByText('jamie@example.test', { exact: true }),
  ).toHaveCount(0)
  state.allowed = true
  await page.getByRole('button', { name: 'Reload inbox', exact: true }).click()
  const open = page.getByRole('button', {
    name: 'Prepare CRM handoff for jamie@example.test',
  })
  await expect(open).toBeEnabled()
  state.allowed = false
  await open.click()
  await expect(
    page
      .getByRole('alert')
      .filter({
        hasText: /Flowrish staff access is required\.|Reload handoff/,
      }),
  ).toContainText('Flowrish staff access is required.')
  await expect(
    page.getByText('jamie@example.test', { exact: true }),
  ).toHaveCount(0)
  expect(state.requests).toEqual([])
  expect(state.unexpected).toEqual([])
})
test('staff waitlist resolves an uncertain handoff from its receipt without retrying the write', async ({
  page,
  baseURL,
}) => {
  const state = await mockedInbox(page, baseURL!)
  state.uncertain = true
  await page.goto('/staff/waitlist')
  const open = page.getByRole('button', {
    name: 'Prepare CRM handoff for jamie@example.test',
  })
  await expect(open).toBeEnabled()
  await newLead(page)
  await approve(page)
  await page
    .getByRole('button', { name: 'Confirm CRM handoff', exact: true })
    .click()
  await expect(
    page
      .getByRole('alert')
      .filter({
        hasText: /Flowrish staff access is required\.|Reload handoff/,
      }),
  ).toContainText('Reload handoff')
  await page
    .getByRole('button', { name: 'Reload handoff', exact: true })
    .click()
  await expect(
    page.getByRole('region', { name: 'CRM handoff receipt', exact: true }),
  ).toContainText('already been handed to CRM')
  expect(commits(state)).toHaveLength(1)
  expect(state.unexpected).toEqual([])
})
