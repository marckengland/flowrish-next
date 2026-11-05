import { expect, test, type Page } from '@playwright/test'
import { coreIds } from './rehearsal-app/core-fixtures'
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' })
const email = 'lead@example.invalid', scope = { organizationId: coreIds.organization, userId: coreIds.user }, endpoint = `/api/leads/${coreIds.lead}/contact-preferences`
const store = () => ({ blocked: false, canBlock: true, canUnblock: true, revision: 1, reason: '', lost: false, revoked: false, stale: false, reads: 0, applied: 0, writes: [] as Array<Record<string, unknown>>, unexpected: [] as string[] })
async function mock(page: Page, baseURL: string, state: ReturnType<typeof store>) {
  const origin = new URL(baseURL).origin
  await page.route('**/*', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const result = () => route.fulfill({ json: { data: { version: state.revision.toString(16).padStart(64, '0'), canBlock: state.canBlock, canUnblock: state.canUnblock, addresses: [{ email, blocked: state.blocked, reason: state.reason || null, revision: state.revision, updatedById: coreIds.user, updatedAt: '2026-11-05T00:00:00Z' }] }, scope: state.stale ? { ...scope, userId: 'other' } : scope, capabilities: { canWrite: state.canBlock } } })
    if (new URL(request.url()).origin !== origin || /receptionist-widget/.test(path)) { state.unexpected.push(`${method} ${path}`); await route.abort(); return }
    if (path === endpoint) {
      expect(request.headers()['x-flowrish-workspace']).toBe(scope.organizationId); expect(request.headers()['x-flowrish-follow-up-scope']).toBe(JSON.stringify([scope.organizationId, scope.userId]))
      if (method === 'GET') { state.reads++; await result(); return }
      if (method === 'POST') {
        const body = request.postDataJSON(); state.writes.push(body); expect(body).toMatchObject({ email, confirmed: true, expectedVersion: state.revision.toString(16).padStart(64, '0') }); expect(String(body.reason).length).toBeGreaterThanOrEqual(3)
        if (state.revoked) { await route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'Access revoked' } } }); return }
        state.blocked = body.action === 'block'; state.reason = body.reason; state.revision++; state.applied++
        if (state.lost) { state.lost = false; await route.abort('failed'); return }
        await result(); return
      }
    }
    if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(method)) { state.unexpected.push(`${method} ${path}`); await route.abort(); return }
    await route.continue()
  })
}
async function review(page: Page, action: 'block' | 'unblock', reason = 'Person asked us to stop') { await page.getByRole('button', { name: action === 'block' ? `Block ${email}` : `Review clearing ${email}`, exact: true }).click(); await page.getByRole('textbox', { name: 'Reason', exact: true }).fill(reason); await page.getByRole('checkbox', { name: /I reviewed this address/ }).check() }
for (const width of [1280, 390]) test(`contact preferences requires reviewed blocking at ${width}px without provider calls`, async ({ page, baseURL }, info) => {
  const state = store(); await page.setViewportSize({ width, height: 900 }); await mock(page, baseURL!, state); await page.goto('/contact-preferences'); await page.getByRole('button', { name: `Block ${email}`, exact: true }).click(); const confirm = page.getByRole('button', { name: 'Confirm block', exact: true }); await expect(confirm).toBeDisabled(); await page.getByRole('textbox', { name: 'Reason', exact: true }).fill('Person asked us to stop'); await expect(confirm).toBeDisabled(); expect(state.writes).toEqual([]); await page.getByRole('checkbox').focus(); await page.keyboard.press('Space'); await confirm.focus(); await page.keyboard.press('Enter'); await expect(page.getByText('Email outreach is blocked for this lead.', { exact: true })).toBeVisible(); expect(state.applied).toBe(1); expect(state.writes).toHaveLength(1); expect(state.writes[0]).toMatchObject({ action: 'block', confirmed: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath('contact-preferences.png'), fullPage: true }); expect(state.unexpected).toEqual([])
})
test('contact preferences permits read-only inspection without exposing mutation controls', async ({ page, baseURL }) => {
  const state = store(); state.blocked = true; state.canBlock = false; state.canUnblock = false; state.reason = 'Requested no email outreach'; await mock(page, baseURL!, state); await page.goto('/contact-preferences'); await expect(page.getByText('Email outreach is blocked for this lead.', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: /Review clearing|Block lead/ })).toHaveCount(0); expect(state.writes).toEqual([]); expect(state.applied).toBe(0); expect(state.unexpected).toEqual([])
})
test('contact preferences clears a restriction only after a new explicit review without restarting cadences', async ({ page, baseURL }) => {
  const state = store(); state.blocked = true; state.reason = 'Requested no email outreach'; await mock(page, baseURL!, state); await page.goto('/contact-preferences'); await review(page, 'unblock', 'Reviewed renewed contact request'); expect(state.writes).toEqual([]); await expect(page.getByText(/Clearing never restarts a stopped cadence/)).toBeVisible(); await page.getByRole('button', { name: 'Confirm clearing restriction', exact: true }).click(); await expect(page.getByText('No listed email address is blocked.', { exact: true })).toBeVisible(); await expect(page.getByText('Contact preference saved. Stopped cadences stay stopped.', { exact: true })).toBeVisible(); expect(state.writes).toHaveLength(1); expect(state.writes[0]).toMatchObject({ action: 'unblock', reason: 'Reviewed renewed contact request' }); expect(state.unexpected).toEqual([])
})
test('contact preferences resolves a lost confirmation by reading status without retrying a write', async ({ page, baseURL }) => {
  const state = store(); state.lost = true; await mock(page, baseURL!, state); await page.goto('/contact-preferences'); await review(page, 'block', 'Retain this contact review reason'); await page.getByRole('button', { name: 'Confirm block', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByRole('textbox', { name: 'Reason', exact: true })).toHaveValue('Retain this contact review reason'); await expect(page.getByRole('button', { name: 'Confirm block', exact: true })).toBeDisabled(); expect(state.writes).toHaveLength(1); expect(state.reads).toBe(1); expect(state.applied).toBe(1); await page.getByRole('button', { name: 'Refresh status', exact: true }).click(); await expect(page.getByText('Email outreach is blocked for this lead.', { exact: true })).toBeVisible(); expect(state.writes).toHaveLength(1); expect(state.reads).toBe(2); await expect(page.getByRole('checkbox')).toHaveCount(0); expect(state.unexpected).toEqual([])
})
test('contact preferences clears private content for stale or revoked actors without additional writes', async ({ page, baseURL }) => {
  const state = store(); state.stale = true; await mock(page, baseURL!, state); await page.goto('/contact-preferences'); await expect(page.getByText('Access changed. Reload before continuing.', { exact: true })).toBeVisible(); await expect(page.getByText(email, { exact: true })).toHaveCount(0); expect(state.writes).toEqual([]); state.stale = false; await page.reload(); await review(page, 'block'); state.revoked = true; await page.getByRole('button', { name: 'Confirm block', exact: true }).click(); await expect(page.getByText('Access changed. Reload before continuing.', { exact: true })).toBeVisible(); await expect(page.getByText(email, { exact: true })).toHaveCount(0); await expect(page.getByRole('textbox', { name: 'Reason', exact: true })).toHaveCount(0); expect(state.writes).toHaveLength(1); expect(state.applied).toBe(0); expect(state.unexpected).toEqual([])
})
