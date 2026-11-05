import { expect, test, type Page } from '@playwright/test'
import { coreIds } from './rehearsal-app/core-fixtures'
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block', timezoneId: 'Asia/Manila' })
const context = { organizationId: coreIds.organization, userId: coreIds.user }, id = '77777777-7777-4777-8777-777777777777', at = '2026-11-05T00:00:00.000Z'
const item = { id, sourceType: 'CALL', sourceText: 'Synthetic callback request', title: 'Return the callback', description: 'Confirm availability', draftSubject: null, draftBody: null, status: 'PENDING', taskId: coreIds.task, lead: { id: coreIds.lead, firstName: 'Practice', lastName: 'Clinic', email: 'lead@example.invalid' }, createdAt: at }
function store() { return { until: null as string | null, revision: 0, due: false, read: false, lost: false, stale: false, canWrite: true, gone: false, email: false, writes: [] as Array<{ path: string; body: Record<string, unknown> }>, unexpected: [] as string[] } }
const version = (s: ReturnType<typeof store>) => String(s.revision + 1).repeat(64)
const value = (s: ReturnType<typeof store>) => ({ ...item, ...(s.email ? { sourceType: 'EMAIL', taskId: null, draftSubject: 'Proposal', draftBody: 'Synthetic template' } : {}), snoozeVersion: version(s), snooze: s.revision ? { until: s.until, timeZone: 'Asia/Manila', revision: s.revision } : null })
async function mock(page: Page, baseURL: string, s: ReturnType<typeof store>) {
  const origin = new URL(baseURL).origin
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method()
    const json = (data: unknown) => route.fulfill({ json: { data, scope: s.stale ? { ...context, userId: 'other' } : context, capabilities: { canWrite: s.canWrite } } })
    if (url.origin !== origin || /receptionist-widget/.test(path)) { s.unexpected.push(`${method} ${path}`); await route.abort(); return }
    if (path.startsWith('/api/follow-ups')) {
      expect(req.headers()['x-flowrish-workspace']).toBe(context.organizationId); expect(req.headers()['x-flowrish-follow-up-scope']).toBe(JSON.stringify([context.organizationId, context.userId]))
      if (method === 'GET' && path === '/api/follow-ups') { const selected = url.searchParams.get('status'), retained = url.searchParams.getAll('retain').includes(id); await json(!s.gone && (retained || (selected === 'SNOOZED' ? s.until && !s.due : selected === 'PENDING' && (!s.until || s.due))) ? [value(s)] : []); return }
      if (method === 'POST' && path === `/api/follow-ups/${id}/snooze`) {
        const body = req.postDataJSON(); expect(body.expectedVersion).toBe(version(s)); expect(s.canWrite).toBe(true); s.writes.push({ path, body }); s.revision++; s.until = body.action === 'wake' ? null : new Date(`${body.localTime}:00+08:00`).toISOString(); s.due = false; s.read = false
        if (s.lost) { s.lost = false; await route.abort('failed'); return }; await json(value(s)); return
      }
    }
    if (method === 'GET' && path === '/api/email/matches') { await json([]); return }
    if (path.startsWith('/api/email-notifications')) {
      expect(req.headers()['x-flowrish-workspace']).toBe(context.organizationId); expect(req.headers()['x-flowrish-email-notification-user']).toBe(context.userId)
      const key = version(s), rows = s.until && s.due && !s.gone ? [{ key, kind: 'follow_up_reminder', messageId: null, followUpId: id, createdAt: s.until, readAt: s.read ? at : null }] : []
      if (method === 'GET' && path.endsWith('/count')) { await json({ unread: s.read ? 0 : rows.length }); return }
      if (method === 'GET' && path === '/api/email-notifications') { await json({ rows: rows.filter(row => url.searchParams.get('filter') === 'all' || !row.readAt), page: 1, hasMore: false }); return }
      if (method === 'GET' && path === `/api/email-notifications/follow-up/${id}`) { if (!rows.length) await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Reminder is no longer available.' } } }); else await json(value(s)); return }
      if (method === 'PATCH' && path === `/api/email-notifications/${key}`) { const body = req.postDataJSON(); expect(body).toEqual({ read: true }); s.writes.push({ path, body }); s.read = true; await json({ key, readAt: at }); return }
    }
    if (method === 'GET' && path.startsWith('/api/callback-notifications')) { await route.fulfill({ json: { data: path.endsWith('/count') ? { unread: 0 } : { rows: [], page: 1, hasMore: false } } }); return }
    if (method === 'GET' && path === '/api/email/sync') { await route.fulfill({ json: { data: [], capabilities: { canWrite: false } } }); return }
    if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(method)) { s.unexpected.push(`${method} ${path}`); await route.abort(); return }
    await route.continue()
  })
}
const card = (p: Page) => p.getByRole('article', { name: 'Follow-up for Practice Clinic' })
test('follow-up snooze tomorrow hides pending, persists across reopening, and wakes explicitly', async ({ page, baseURL }) => {
  const s = store(); await mock(page, baseURL!, s); await page.goto('/follow-up-access'); await card(page).getByRole('button', { name: 'Snooze until tomorrow' }).click(); await expect(card(page)).toHaveCount(0); expect(s.writes).toHaveLength(1); expect(s.writes[0].body).toMatchObject({ action: 'snooze', timeZone: 'Asia/Manila' }); expect(String(s.writes[0].body.localTime)).toMatch(/T09:00$/)
  await page.reload(); await expect(page.getByText('No pending follow-ups', { exact: true })).toBeVisible(); await page.getByRole('tab', { name: 'Snoozed', exact: true }).click(); await expect(card(page)).toBeVisible(); await card(page).getByRole('button', { name: 'Wake now' }).click(); await expect(card(page)).toHaveCount(0); await page.getByRole('tab', { name: 'Pending', exact: true }).click(); await expect(card(page)).toBeVisible(); expect(s.writes).toHaveLength(2); expect(s.unexpected).toEqual([])
})
test('follow-up snooze accepts a custom local minute and remains usable on mobile', async ({ page, baseURL }, info) => {
  const s = store(); await page.setViewportSize({ width: 390, height: 844 }); await mock(page, baseURL!, s); await page.goto('/follow-up-access'); await card(page).getByLabel('Snooze until', { exact: true }).fill('2026-12-03T14:30'); await card(page).getByRole('button', { name: 'Set snooze' }).click(); await expect(card(page)).toHaveCount(0); expect(s.until).toBe('2026-12-03T06:30:00.000Z'); await page.getByRole('tab', { name: 'Snoozed', exact: true }).click(); await expect(card(page).getByText(/Task due dates and callback deadlines stay the same/)).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath('snoozed-mobile.png'), fullPage: true }); expect(s.writes).toHaveLength(1); expect(s.unexpected).toEqual([])
})
test('follow-up snooze due reminders open exact callback work and new revisions remain unread', async ({ page, baseURL }) => {
  const s = store(); s.until = at; s.revision = 1; s.due = true; await mock(page, baseURL!, s); await page.goto('/email-alerts'); await expect(page.getByRole('article', { name: 'Follow-up reminder', exact: true })).toBeVisible(); expect(s.writes).toEqual([]); await page.getByRole('button', { name: 'Mark follow-up alert read' }).click(); await expect(page.getByRole('article', { name: 'Follow-up reminder', exact: true })).toHaveCount(0); await page.goto(`/follow-ups?reply=${id}`); await expect(card(page).getByText(item.sourceText, { exact: true })).toBeVisible(); await card(page).getByRole('button', { name: 'Snooze until tomorrow' }).click(); await expect(card(page)).toHaveCount(0); s.due = true; await page.goto('/email-alerts'); await expect(page.getByRole('article', { name: 'Follow-up reminder', exact: true })).toBeVisible(); await page.getByRole('link', { name: 'Review follow-up', exact: true }).click(); await expect(card(page)).toBeVisible(); expect(s.writes).toHaveLength(2); expect(s.unexpected).toEqual([])
})
test('follow-up snooze requires explicit discard of an open unsent draft', async ({ page, baseURL }) => {
  const s = store(); s.email = true; await mock(page, baseURL!, s); await page.goto('/follow-up-access'); await card(page).getByRole('button', { name: 'Review email draft' }).click(); await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('Keep this unsent edit'); await card(page).getByRole('button', { name: 'Snooze until tomorrow' }).click(); await expect(page.getByRole('group', { name: 'Snooze draft confirmation' })).toBeVisible(); expect(s.writes).toEqual([]); await page.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('Keep this unsent edit'); await card(page).getByRole('button', { name: 'Snooze until tomorrow' }).click(); await page.getByRole('button', { name: 'Discard draft and snooze' }).click(); await expect(card(page)).toHaveCount(0); expect(s.writes).toHaveLength(1); expect(s.unexpected).toEqual([])
})
test('follow-up snooze lost confirmation requires refresh with no automatic repeat write', async ({ page, baseURL }) => {
  const s = store(); s.lost = true; await mock(page, baseURL!, s); await page.goto('/follow-up-access'); await card(page).getByRole('button', { name: 'Snooze until tomorrow' }).click(); await expect(card(page).getByRole('region', { name: 'Snooze follow-up' }).getByRole('alert')).toContainText('Refresh the inbox before trying again'); await expect(card(page).getByRole('button', { name: 'Snooze until tomorrow' })).toBeDisabled(); expect(s.writes).toHaveLength(1); await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(card(page)).toHaveCount(0); await page.getByRole('tab', { name: 'Snoozed', exact: true }).click(); await expect(card(page)).toBeVisible(); expect(s.writes).toHaveLength(1); expect(s.unexpected).toEqual([])
})
test('follow-up snooze clears stale identity, respects current read-only capability and resolved work', async ({ page, baseURL }) => {
  const s = store(); s.canWrite = false; await mock(page, baseURL!, s); await page.goto('/follow-up-access'); await expect(card(page)).toBeVisible(); await expect(card(page).getByRole('button', { name: 'Snooze until tomorrow' })).toHaveCount(0); s.canWrite = true; s.stale = true; await page.reload(); await expect(page.getByText('Access changed. Reload before continuing.', { exact: true })).toBeVisible(); await expect(card(page)).toHaveCount(0); s.stale = false; s.gone = true; await page.goto(`/follow-ups?reply=${id}`); await expect(page.getByText('Reminder is no longer available.', { exact: true })).toBeVisible(); await expect(card(page)).toHaveCount(0); expect(s.writes).toEqual([]); expect(s.unexpected).toEqual([])
})
