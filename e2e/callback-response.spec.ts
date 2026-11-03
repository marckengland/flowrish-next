import { expect, test } from '@playwright/test'
import { responseFixture, responseManager } from '../src/components/callbacks/response-fixture.test-data'
const callbackId = '22222222-2222-4222-8222-222222222222', taskId = '33333333-3333-4333-8333-333333333333', stamp = '2026-11-03T00:00:00.000Z'
for (const mobile of [false, true]) {
  test(`configures response targets and reviews escalation with mocked writes on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    await page.clock.install()
    const state = responseFixture(), unexpected: string[] = []; let saves = 0, reads = 0, ready = false, readAt: string | null = null
    const targetRows = () => state.policy.enabled && ready ? [{ callbackId, phase: 'handoff', startedAt: stamp, dueAt: stamp, taskId: null, assigneeName: null, missed: true }, { callbackId: taskId, phase: 'attempt', startedAt: stamp, dueAt: stamp, taskId, assigneeName: 'Sample Owner', missed: true }] : []
    const notices = () => state.policy.enabled && ready ? [{ key: 'a'.repeat(64), kind: 'handoff_escalation', callbackId, taskId: null, dueDate: stamp, createdAt: stamp, readAt }] : []
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (/\/(?:api\/(?:ai|voice|calling|public\/website-receptionist|admin\/ai-provider|inngest))(?:\/|$)/.test(url.pathname) || /(^|\.)(?:deepseek\.com|openai\.com|anthropic\.com|googleapis\.com|openrouter\.ai|tokenrouter\.com|twilio\.com)$/.test(url.hostname) || (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method()))) { unexpected.push(`${request.method()} ${url.pathname}`); await route.fulfill({ status: 503, json: {} }); return }
      await route.continue()
    })
    await page.route('**/api/admin/receptionist', route => route.fulfill({ json: { config: null, businessName: 'Sample Repairs', currentUserId: responseManager, members: [], stages: [], calls: [], webhookPath: '/api/voice/receptionist/test' } }))
    await page.route('**/api/admin/callback-response-policy', async route => {
      const request = route.request()
      if (request.method() === 'GET') { await route.fulfill({ json: { data: state } }); return }
      expect(request.method()).toBe('PUT'); saves++; const body = request.postDataJSON(); expect(body).not.toHaveProperty('hours'); expect(body).not.toHaveProperty('organizationId')
      if (saves === 1) { expect(body.enabled).toBe(true); expect(body.acknowledged).toBe(true); state.policy.handoffMinutes = 30; state.policy.updatedAt = stamp; await route.fulfill({ status: 409, json: { error: { message: '<img src=x> PRIVATE DIAGNOSTIC' } } }); return }
      expect(body.expectedUpdatedAt).toBe(state.policy.updatedAt); expect(body.expectedBusinessUpdatedAt).toBe(state.business.updatedAt)
      if (body.enabled) { expect(body.acknowledged).toBe(true); expect(body.backupUserId).toBe(responseManager) }
      state.policy = { ...state.policy, enabled: body.enabled, handoffMinutes: body.handoffMinutes, attemptMinutes: body.attemptMinutes, backupUserId: body.backupUserId, hours: state.business.hours, businessUpdatedAt: state.business.updatedAt, updatedAt: `2026-11-03T00:0${saves}:00.000Z` }; state.managerAvailable = true
      await route.fulfill({ json: { data: state } })
    })
    await page.route('**/api/callback-response-targets**', async route => { expect(route.request().method()).toBe('GET'); const url = new URL(route.request().url()); await route.fulfill({ json: { data: { rows: targetRows(), page: Number(url.searchParams.get('page')), hasMore: false, policyEnabled: state.policy.enabled } } }) })
    await page.route('**/api/callback-notifications**', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.pathname.endsWith('/count')) { expect(request.headers()['x-flowrish-response-targets']).toBe('1'); await route.fulfill({ json: { data: { unread: notices().filter(row => !row.readAt).length } } }); return }
      if (request.method() === 'GET') { expect(request.headers()['x-flowrish-response-targets']).toBe('1'); await route.fulfill({ json: { data: { rows: notices().filter(row => url.searchParams.get('filter') === 'all' || !row.readAt), page: 1, hasMore: false } } }); return }
      expect(request.method()).toBe('PATCH'); expect(request.postDataJSON()).toEqual({ read: true }); reads++; readAt = stamp; await route.fulfill({ json: { data: { key: 'a'.repeat(64), readAt } } })
    })
    await page.goto('/settings?section=receptionist'); await page.getByRole('link', { name: 'Manage callback response targets', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Callback response targets', exact: true })).toBeVisible()
    const enable = page.getByRole('checkbox', { name: 'Enable callback response targets', exact: true }), save = page.getByRole('button', { name: 'Save response targets', exact: true }), handoff = page.getByRole('spinbutton', { name: 'CRM handoff target (business minutes)', exact: true })
    await expect(enable).not.toBeChecked(); expect(saves).toBe(0); await enable.check(); await page.getByRole('combobox', { name: 'Escalation manager', exact: true }).selectOption(responseManager); await expect(save).toBeDisabled(); await page.getByRole('checkbox', { name: /I approve applying/ }).check(); await save.click(); await expect(page.getByRole('main').getByRole('alert')).toContainText('Your edits have been kept'); await expect(enable).toBeChecked(); await expect(handoff).toHaveValue('60'); await expect(page.getByText('PRIVATE DIAGNOSTIC', { exact: false })).toHaveCount(0)
    await page.getByRole('button', { name: 'Reload target settings', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(enable).toBeChecked(); await page.getByRole('button', { name: 'Reload target settings', exact: true }).click(); await page.getByRole('button', { name: 'Discard unsaved edits', exact: true }).click(); await expect(handoff).toHaveValue('30'); await enable.check(); await handoff.fill('90'); await page.getByRole('combobox', { name: 'Escalation manager', exact: true }).selectOption(responseManager); await page.getByRole('checkbox', { name: /I approve applying/ }).check(); await save.click(); await expect(page.getByText('Response targets saved. The next scheduled check will refresh waiting deadlines.', { exact: true })).toBeVisible()
    ready = true; await page.getByRole('button', { name: 'Refresh response targets', exact: true }).click(); await expect(page.getByRole('heading', { name: 'CRM handoff target missed', exact: true })).toBeVisible(); await expect(page.getByRole('link', { name: 'Open callback task', exact: true })).toHaveAttribute('href', `/tasks/${taskId}`); await expect(page.getByText('Sample Owner', { exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `/tmp/flowrish-response-${mobile ? 'mobile' : 'desktop'}.png` })
    await page.clock.fastForward(61000); await page.getByRole('link', { name: 'Notifications, 1 unread', exact: true }).click(); await expect(page.getByRole('heading', { name: 'CRM handoff target missed', exact: true })).toBeVisible(); await expect(page.getByRole('link', { name: 'Review callback requests', exact: true })).toHaveAttribute('href', '/settings?section=receptionist'); await page.getByRole('button', { name: 'Mark read', exact: true }).click(); await expect(page.getByText('No notifications in this view.', { exact: true })).toBeVisible(); expect(reads).toBe(1)
    await page.getByRole('link', { name: 'View callback response targets', exact: true }).click(); await expect(enable).toBeChecked(); await enable.uncheck(); await expect(save).toBeEnabled(); await save.click(); await expect(page.getByText('Response targets are paused. An administrator can enable a policy above.', { exact: true })).toBeVisible(); expect(saves).toBe(3); expect(unexpected).toEqual([])
  })
}
