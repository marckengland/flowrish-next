import { expect, test, type Locator, type Page } from '@playwright/test'
import { coreIds, coreTask } from './rehearsal-app/core-fixtures'
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' })
const studio = '11111111-1111-4111-8111-111111111111', clinic = '22222222-2222-4222-8222-222222222222'
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 60; i++) {
    if (await target.evaluate(el => document.activeElement === el)) return
    await page.keyboard.press('Tab')
  }
  await expect(target).toBeFocused()
}
test('keyboard audit retains native editable controls in the dialog tab loop', async ({ page, baseURL }) => {
  const state = await mock(page, baseURL!)
  await page.goto('/keyboard')
  const trigger = page.getByRole('button', { name: 'Open rich note', exact: true })
  await tabTo(page, trigger); await page.keyboard.press('Enter')
  const note = page.getByRole('textbox', { name: 'Rich note', exact: true })
  await expect(note).toBeFocused()
  await page.keyboard.press('Shift+Tab'); await expect(page.getByRole('button', { name: 'Close rich note', exact: true })).toBeFocused()
  await page.keyboard.press('Tab'); await expect(note).toBeFocused()
  await page.keyboard.type('Keyboard input'); await expect(note).toContainText('Keyboard input')
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused()
  expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([])
})
test('keyboard audit releases the mobile navigation trap after resizing to desktop', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const state = await mock(page, baseURL!)
  await page.goto('/keyboard')
  const opener = page.locator('button[aria-controls="primary-navigation"]')
  await tabTo(page, opener); await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused()
  await page.setViewportSize({ width: 1365, height: 900 })
  await expect(opener).toHaveAttribute('aria-expanded', 'false')
  const editor = page.getByRole('button', { name: 'Open editor', exact: true })
  await tabTo(page, editor); await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Practice name' })).toBeFocused()
  await page.keyboard.press('Escape'); await expect(editor).toBeFocused()
  expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([])
})
async function mock(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin, context = page.context()
  const state = { writes: [] as Array<{ path: string; body: Record<string, unknown> }>, unexpected: [] as string[] }
  await context.addCookies([{ name: 'mock_workspace', value: studio, url: origin }])
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname
    const reply = (data: unknown) => route.fulfill({ json: { data } })
    if (url.origin !== origin || /receptionist-widget/.test(path)) { state.unexpected.push(path); await route.abort(); return }
    if (path === '/api/lead-views' && req.method() === 'GET') { await route.fulfill({ json: { data: [], scope: { organizationId: coreIds.organization, userId: coreIds.user } } }); return }
    if (path === '/api/workspaces' && req.method() === 'GET') { await reply({ workspaces: [{ id: studio, name: 'Practice Studio' }, { id: clinic, name: 'Practice Clinic' }] }); return }
    if (path === '/api/workspaces' && req.method() === 'POST') {
      const body = req.postDataJSON(); state.writes.push({ path, body })
      await context.addCookies([{ name: 'mock_workspace', value: String(body.organizationId), url: origin }]); await reply({ organizationId: body.organizationId }); return
    }
    if (path === '/api/mock/workspace-leads' && req.method() === 'GET') { await reply({ name: 'Clinic prospect' }); return }
    if (path === '/api/callback-notifications/count' && req.method() === 'GET') { await reply({ unread: 0 }); return }
    if (path === '/api/tasks' && req.method() === 'GET') { await reply([coreTask()]); return }
    if (path === '/api/mock/core/leads' && req.method() === 'POST') {
      state.writes.push({ path, body: req.postDataJSON() }); await route.fulfill({ json: { error: 'Review the highlighted field.', fieldErrors: { email: 'Use the approved practice email.' } } }); return
    }
    if (path === '/api/mock/core/tasks' && req.method() === 'POST') {
      state.writes.push({ path, body: req.postDataJSON() }); await route.fulfill({ json: { error: 'Review the highlighted fields.', fieldErrors: { title: 'Choose a clearer title.', dueDate: 'Choose another callback time.', leadId: 'Choose an accessible lead.', assigneeId: 'Choose an available assignee.' } } }); return
    }
    if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(req.method())) { state.unexpected.push(req.method() + ' ' + path); await route.abort(); return }
    await route.continue()
  })
  return state
}
for (const mobile of [false, true]) {
  test(`keyboard audit dialog editing, Tab loop and nested Escape on ${mobile ? 'mobile' : 'desktop'}`, async ({ page, baseURL }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1365, height: 900 })
    const state = await mock(page, baseURL!)
    await page.goto('/keyboard')
    const trigger = page.getByRole('button', { name: 'Open editor', exact: true })
    await tabTo(page, trigger); await page.keyboard.press('Enter')
    const input = page.getByRole('textbox', { name: 'Practice name' })
    await expect(input).toBeFocused()
    await page.keyboard.type('Keyboard practice')
    await expect(input).toHaveValue('Keyboard practice'); await expect(input).toBeFocused()
    await page.keyboard.press('Shift+Tab'); await expect(page.getByRole('button', { name: 'Cancel editor' })).toBeFocused()
    await page.keyboard.press('Tab'); await expect(input).toBeFocused()
    await page.keyboard.press('Tab'); const innerTrigger = page.getByRole('button', { name: 'Open confirmation' }); await expect(innerTrigger).toBeFocused()
    await page.keyboard.press('Enter'); await expect(page.getByRole('button', { name: 'Review sample' })).toBeFocused()
    await page.keyboard.press('Shift+Tab'); await expect(page.getByRole('button', { name: 'Cancel confirmation' })).toBeFocused()
    await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Review sample' })).toBeFocused()
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'Practice confirmation' })).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Practice editor' })).toBeVisible(); await expect(innerTrigger).toBeFocused()
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(trigger).toBeFocused()
    expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([])
  })
  test(`keyboard audit lead and task labels, validation and priority on ${mobile ? 'mobile' : 'desktop'}`, async ({ page, baseURL }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1365, height: 900 })
    const state = await mock(page, baseURL!)
    await page.goto('/leads/new')
    await tabTo(page, page.getByRole('textbox', { name: 'First Name' })); await page.keyboard.type('Keyboard')
    await page.keyboard.press('Tab'); await expect(page.getByRole('textbox', { name: 'Last Name' })).toBeFocused(); await page.keyboard.type('Prospect')
    const email = page.getByRole('textbox', { name: 'Email', exact: true })
    await tabTo(page, email); await page.keyboard.type('practice@example.test')
    await tabTo(page, page.getByRole('button', { name: 'Create lead', exact: true })); await page.keyboard.press('Enter')
    await expect(email).toHaveAttribute('aria-invalid', 'true'); await expect(email).toHaveAccessibleDescription('Use the approved practice email.')
    await page.goto('/tasks')
    const title = page.getByRole('textbox', { name: 'Title', exact: false })
    await tabTo(page, title); await page.keyboard.type('Practice callback')
    const due = page.getByLabel('Due date', { exact: false }); await tabTo(page, due); await due.fill('2030-11-04T10:00')
    await tabTo(page, page.getByRole('radio', { name: 'Medium', exact: true })); await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('radio', { name: 'High', exact: true })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Tab'); await expect(page.getByRole('combobox', { name: 'Lead', exact: false })).toBeFocused()
    await tabTo(page, page.getByRole('button', { name: 'Create Task', exact: true })); await page.keyboard.press('Enter')
    for (const [control, message] of [[title, 'Choose a clearer title.'], [due, 'Choose another callback time.'], [page.getByRole('combobox', { name: 'Lead', exact: false }), 'Choose an accessible lead.'], [page.getByRole('combobox', { name: 'Assignee', exact: false }), 'Choose an available assignee.']] as const) {
      await expect(control).toHaveAttribute('aria-invalid', 'true'); await expect(control).toHaveAccessibleDescription(message)
    }
    expect(state.writes.map(write => write.path)).toEqual(['/api/mock/core/leads', '/api/mock/core/tasks'])
    expect(state.writes[1].body.priority).toBe('HIGH'); expect(state.writes[1].body.leadId).toBe(coreIds.lead)
    expect(state.unexpected).toEqual([])
  })
  test(`keyboard audit navigation and native business switching on ${mobile ? 'mobile' : 'desktop'}`, async ({ page, baseURL }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1365, height: 900 })
    const state = await mock(page, baseURL!)
    await page.goto('/keyboard')
    const business = page.getByRole('combobox', { name: 'Business', exact: true })
    if (mobile) {
      const opener = page.getByRole('button', { name: 'Open navigation', exact: true })
      await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toHaveCount(0)
      await expect(opener).toHaveAttribute('aria-expanded', 'false')
      await page.keyboard.press('Tab'); await expect(opener).toBeFocused()
      await page.keyboard.press('Enter'); await expect(opener).toHaveAttribute('aria-expanded', 'true')
      await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused()
      await page.keyboard.press('Escape'); await expect(opener).toBeFocused(); await expect(opener).toHaveAttribute('aria-expanded', 'false')
      await page.keyboard.press('Enter')
      await expect.poll(async () => page.locator('#primary-navigation').evaluate(el => Math.round(el.getBoundingClientRect().left))).toBe(0)
    }
    await expect(business).toBeEnabled(); await tabTo(page, business)
    expect(await business.evaluate(el => { const s = getComputedStyle(el); return s.outlineStyle !== 'none' || s.boxShadow !== 'none' })).toBe(true)
    await page.screenshot({ path: `test-results/rehearsal/keyboard-${mobile ? 'mobile' : 'desktop'}-business-focus.png`, fullPage: true })
    await page.keyboard.type('Practice Clinic'); await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Practice Clinic', exact: true })).toBeVisible()
    expect(state.writes).toEqual([{ path: '/api/workspaces', body: { organizationId: clinic } }]); expect(state.unexpected).toEqual([])
  })
}
