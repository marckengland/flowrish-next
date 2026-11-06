import {revealFollowUpFilters} from './helpers/follow-up-filters'
import {revealFollowUpDetails} from './helpers/follow-up-details'
import { expect, test, type Page } from '@playwright/test'
import { coreIds } from './rehearsal-app/core-fixtures'
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block', timezoneId: 'UTC' })
const scope = { organizationId: coreIds.organization, userId: coreIds.user }, stamp = '2026-11-06T01:00:00.000Z'
const id = '11111111-7777-4777-8777-777777777777', taskId = '22222222-7777-4777-8777-777777777777'
const state = () => ({ completed: false, readonly: false, unavailable: false, lost: false, stale: false, changed: false, version: 'a'.repeat(64), title: 'Current callback task', writes: [] as Record<string, unknown>[], reads: [] as string[], unexpected: [] as string[], requestId: '' })
async function mock(page: Page, base: string, s: ReturnType<typeof state>) {
 const origin = new URL(base).origin
 await page.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method()
  const json = (data: unknown) => route.fulfill({ json: { data, scope: s.stale ? { ...scope, userId: 'other' } : scope, capabilities: { canWrite: !s.readonly, taskProgress: true } } })
  if (url.origin !== origin || /receptionist-widget/.test(path)) { s.unexpected.push(method + ' ' + path); await route.abort(); return }
  if (path === '/api/follow-ups' && method === 'GET') {
   s.reads.push(url.search); expect(req.headers()['x-flowrish-workspace']).toBe(scope.organizationId); expect(req.headers()['x-flowrish-follow-up-scope']).toBe(JSON.stringify([scope.organizationId, scope.userId]))
   await json(url.searchParams.get('status') === 'APPROVED' ? [{ id, taskId, status: 'APPROVED', sourceType: 'EMAIL', sourceText: 'Synthetic callback follow-up', title: 'Original suggestion title', description: 'Synthetic notes', draftSubject: 'Quote', draftBody: 'Synthetic unsent reply', createdAt: stamp, taskProgress: s.unavailable ? { state: 'UNAVAILABLE' } : { state: s.completed ? 'COMPLETED' : 'OVERDUE', dueDate: '2020-01-01T00:00:00.000Z', completedAt: s.completed ? stamp : null, checkedAt: stamp }, lead: { id: coreIds.lead, firstName: 'Practice', lastName: 'Clinic', email: 'lead@example.invalid' } }] : []); return
  }
  if (path === '/api/follow-ups/' + id + '/task-completion') {
   expect(req.headers()['x-flowrish-workspace']).toBe(scope.organizationId); expect(req.headers()['x-flowrish-follow-up-scope']).toBe(JSON.stringify([scope.organizationId, scope.userId]))
   if (method === 'GET') {
    s.reads.push(url.pathname + url.search)
    if (url.searchParams.has('requestId')) { expect(url.searchParams.get('requestId')).toBe(s.requestId); await json({ id, requestId: s.requestId, state: s.completed ? 'confirmed' : 'not-recorded', task: s.completed ? { id: taskId, dueDate: '2020-01-01T00:00:00.000Z', completedAt: stamp, checkedAt: stamp } : null }); return }
    await json({ id, version: s.version, leadName: 'Practice Clinic', task: { id: taskId, title: s.title, description: 'Private reviewed task details', assigneeId: scope.userId, assigneeName: 'Practice Owner', dueDate: '2020-01-01T00:00:00.000Z' } }); return
   }
   if (method === 'POST') {
    const body = req.postDataJSON(); s.writes.push(body); expect(Object.keys(body).sort()).toEqual(['expectedVersion', 'requestId', 'taskId']); expect(body.taskId).toBe(taskId)
    if (s.changed || body.expectedVersion !== s.version) { await route.fulfill({ status: 409, json: { error: { code: 'FOLLOW_UP_CHANGED', message: 'The task changed. Review again.' } } }); return }
    s.requestId = body.requestId; s.completed = true
    if (s.lost) { s.lost = false; await route.abort('failed'); return }
    await json({ id, requestId: body.requestId, state: 'confirmed', task: { id: taskId, dueDate: '2020-01-01T00:00:00.000Z', completedAt: stamp, checkedAt: stamp } }); return
   }
  }
  if (path === '/api/email/matches' && method === 'GET') { await json([]); return }
  if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(method)) { s.unexpected.push(method + ' ' + path); await route.abort(); return }
  await route.continue()
 })
}
const card = (page: Page) => page.getByRole('article', { name: 'Follow-up for Practice Clinic', exact: true })
const completion = (page: Page) => card(page).getByRole('region', { name: 'Task completion', exact: true })
async function approved(page: Page) { await page.goto('/follow-up-access'); await expect(page.getByText('No pending follow-ups', { exact: true })).toBeVisible(); await page.getByRole('tab', { name: 'Approved', exact: true }).click(); await expect(card(page)).toBeVisible() }
async function review(page: Page) { await revealFollowUpDetails(page); await completion(page).getByRole('button', { name: 'Review task completion', exact: true }).click(); await expect(completion(page).getByRole('group', { name: 'Task completion review', exact: true })).toBeVisible() }
for (const width of [1280, 390]) test('approved task completion reviews, cancels and confirms while retaining a mounted draft at ' + width + 'px', async ({ page, baseURL }, info) => {
 const s = state(); await page.setViewportSize({ width, height: 900 }); await mock(page, baseURL!, s); await approved(page)
 await revealFollowUpFilters(page); const filters = page.getByRole('search', { name: 'Follow-up filters', exact: true }); await revealFollowUpFilters(page); await filters.getByRole('combobox', { name: 'Task progress', exact: true }).selectOption('OPEN'); await revealFollowUpFilters(page); await filters.getByRole('button', { name: 'Apply filters', exact: true }).click(); await expect(card(page)).toBeVisible(); await revealFollowUpFilters(page); await expect(filters.getByRole('button', { name: 'Apply filters', exact: true })).toBeEnabled()
 await card(page).getByRole('button', { name: 'Review email draft', exact: true }).click(); const subject = page.getByRole('textbox', { name: 'Subject', exact: true }); await subject.fill('Keep completed callback draft'); await subject.evaluate(el => el.setAttribute('data-synthetic-mounted', 'original'))
 await review(page); const group = completion(page).getByRole('group', { name: 'Task completion review', exact: true }); await expect(group).toContainText('Current callback task'); await expect(group).toContainText('Practice Owner'); await expect(group).toContainText('Private reviewed task details'); expect(s.writes).toEqual([])
 await group.getByRole('button', { name: 'Cancel completion', exact: true }).click(); await expect(group).toHaveCount(0); expect(s.writes).toEqual([]); await review(page); const confirm = completion(page).getByRole('button', { name: 'Confirm task completion', exact: true }); await confirm.focus(); await page.keyboard.press('Enter')
 await expect(completion(page).getByRole('status')).toHaveText('Task completion confirmed.'); await expect(card(page).getByText('Completed', { exact: true })).toBeVisible(); await expect(subject).toHaveValue('Keep completed callback draft'); await expect(subject).toHaveAttribute('data-synthetic-mounted', 'original'); await revealFollowUpFilters(page); await expect(filters.getByRole('combobox', { name: 'Task progress', exact: true })).toHaveValue('OPEN'); expect(s.writes).toHaveLength(1); await expect(completion(page).getByRole('button', { name: 'Confirm task completion', exact: true })).toHaveCount(0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath('approved-task-completion.png'), fullPage: true }); expect(s.unexpected).toEqual([])
})
test('approved task completion verifies a lost confirmation with one read and no repeated write', async ({ page, baseURL }) => {
 const s = state(); s.lost = true; await mock(page, baseURL!, s); await approved(page); await review(page); await completion(page).getByRole('button', { name: 'Confirm task completion', exact: true }).click()
 await expect(completion(page).getByRole('alert')).toContainText('Completion is not confirmed.'); await expect(completion(page).getByRole('button', { name: 'Confirm task completion', exact: true })).toHaveCount(0); expect(s.writes).toHaveLength(1)
 await completion(page).getByRole('button', { name: 'Check completion result', exact: true }).click(); await expect(completion(page).getByRole('status')).toHaveText('Task completion confirmed.'); expect(s.writes).toHaveLength(1); expect(s.reads.filter(path => path.includes('?requestId='))).toEqual(['/api/follow-ups/' + id + '/task-completion?requestId=' + s.requestId]); expect(s.unexpected).toEqual([])
})
test('approved task completion rejects a stale review and requires a new explicit confirmation', async ({ page, baseURL }) => {
 const s = state(); await mock(page, baseURL!, s); await approved(page); await review(page); s.version = 'b'.repeat(64); s.title = 'Changed callback task'; await completion(page).getByRole('button', { name: 'Confirm task completion', exact: true }).click(); await expect(completion(page).getByRole('alert')).toHaveText('The task changed. Review again.'); expect(s.completed).toBe(false); expect(s.writes).toHaveLength(1); await expect(completion(page).getByRole('button', { name: 'Confirm task completion', exact: true })).toHaveCount(0)
 await review(page); await expect(completion(page).getByRole('group', { name: 'Task completion review', exact: true })).toContainText('Changed callback task'); expect(s.writes).toHaveLength(1); await completion(page).getByRole('button', { name: 'Confirm task completion', exact: true }).click(); await expect(completion(page).getByRole('status')).toHaveText('Task completion confirmed.'); expect(s.writes).toHaveLength(2); expect(s.unexpected).toEqual([])
})
test('approved task completion hides controls for read-only users and redacts inaccessible reviewed tasks', async ({ page, baseURL }) => {
 const s = state(); s.readonly = true; await mock(page, baseURL!, s); await approved(page); await expect(card(page).getByRole('button', { name: 'Review task completion', exact: true })).toHaveCount(0); s.readonly = false; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await revealFollowUpDetails(page); await expect(card(page).getByRole('button', { name: 'Review task completion', exact: true })).toBeEnabled(); await review(page); s.unavailable = true; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(card(page).getByText('Progress unavailable', { exact: true })).toBeVisible(); await expect(page.getByText('Private reviewed task details', { exact: true })).toHaveCount(0); await expect(card(page).getByRole('button', { name: 'Confirm task completion', exact: true })).toHaveCount(0); expect(s.writes).toEqual([]); expect(s.unexpected).toEqual([])
})
test('approved task completion rejects a stale-account receipt and clears private drafts without another write', async ({ page, baseURL }) => {
 const s = state(); await mock(page, baseURL!, s); await approved(page); await card(page).getByRole('button', { name: 'Review email draft', exact: true }).click(); await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('Private stale completion draft'); await review(page); s.stale = true
 await completion(page).getByRole('button', { name: 'Confirm task completion', exact: true }).click(); await expect(page.getByText('Access changed. Reload before continuing.', { exact: true })).toBeVisible(); await expect(page.getByRole('article')).toHaveCount(0); await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveCount(0); await expect(page.getByText('Private reviewed task details', { exact: true })).toHaveCount(0); expect(s.writes).toHaveLength(1); expect(s.unexpected).toEqual([])
})
