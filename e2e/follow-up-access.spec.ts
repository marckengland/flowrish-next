import {revealFollowUpDetails} from './helpers/follow-up-details'
import { expect, test, type Page } from '@playwright/test'
import { coreIds } from './rehearsal-app/core-fixtures'
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' })
const context = { organizationId: coreIds.organization, userId: coreIds.user }, id = '77777777-7777-4777-8777-777777777777'
const item = { id, sourceType: 'EMAIL', sourceText: 'Private synthetic source', title: 'Private task title', description: 'Private notes', draftSubject: 'Proposal', draftBody: 'Private template body', status: 'PENDING', taskId: null, lead: { id: coreIds.lead, firstName: 'Practice', lastName: 'Clinic', email: 'lead@example.invalid' }, createdAt: '2026-11-05T00:00:00.000Z' }
const state = () => ({ canWrite: true, visible: true, stale: false, reviewStatus: 200, reads: 0, reviews: [] as unknown[], sends: [] as unknown[], unexpected: [] as string[] })
async function mock(page: Page, baseURL: string, data: ReturnType<typeof state>) {
  const origin = new URL(baseURL).origin
  await page.route('**/*', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const json = (value: unknown) => route.fulfill({ json: { data: value, scope: data.stale ? { ...context, userId: 'other' } : context, capabilities: { canWrite: data.canWrite } } })
    if (new URL(request.url()).origin !== origin || /receptionist-widget/.test(path)) { data.unexpected.push(`${method} ${path}`); await route.abort(); return }
    if (path.startsWith('/api/follow-ups') || path === '/api/email/send') {
      expect(request.headers()['x-flowrish-workspace']).toBe(context.organizationId)
      expect(request.headers()['x-flowrish-follow-up-scope']).toBe(JSON.stringify([context.organizationId, context.userId]))
      if (method === 'GET' && path === '/api/follow-ups') { data.reads++; await json(data.visible ? [item] : []); return }
      if (method === 'PATCH' && path === `/api/follow-ups/${id}`) { data.reviews.push(request.postDataJSON()); if (data.reviewStatus !== 200) { await route.fulfill({ status: data.reviewStatus, json: { error: { code: data.reviewStatus === 403 ? 'FORBIDDEN' : 'UNAVAILABLE', message: data.reviewStatus === 403 ? 'Access revoked' : 'Temporary workflow failure' } } }); return }; await json({ ...item, status: 'APPROVED', taskId: coreIds.task }); return }
      if (method === 'POST' && path === '/api/email/send') { data.sends.push(request.postDataJSON()); await json({ messageId: 'mock-sent', threadId: 'mock-thread', attachmentCount: 0 }); return }
    }
    if (method === 'GET' && path === '/api/email/matches') { await json([]); return }
    if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(method)) { data.unexpected.push(`${method} ${path}`); await route.abort(); return }
    await route.continue()
  })
}
test('follow-up access uses current read-only capability despite an older writable page', async ({ page, baseURL }) => {
  const data = state(); data.canWrite = false; await mock(page, baseURL!, data); await page.goto('/follow-up-access'); await expect(page.getByText('Private synthetic source', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Approve task' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Review email draft' })).toHaveCount(0); expect(data.reviews).toEqual([]); expect(data.sends).toEqual([]); expect(data.unexpected).toEqual([])
})
test('follow-up access clears cached private source and composer after a revoked approval', async ({ page, baseURL }) => {
  const data = state(); await mock(page, baseURL!, data); await page.goto('/follow-up-access'); await page.getByRole('button', { name: 'Review email draft' }).click(); await expect(page.getByRole('form', { name: 'Compose email' })).toBeVisible(); data.reviewStatus = 403; await revealFollowUpDetails(page); await page.getByRole('button', { name: 'Approve task' }).click(); await expect(page.getByText('Access changed. Reload before continuing.', { exact: true })).toBeVisible(); await expect(page.getByText('Private synthetic source', { exact: true })).toHaveCount(0); await expect(page.getByRole('form')).toHaveCount(0); expect(data.reviews).toHaveLength(1); expect(data.sends).toEqual([]); expect(data.unexpected).toEqual([])
})
test('follow-up access retains edits after a transient review error and requires an explicit retry', async ({ page, baseURL }) => {
  const data = state(); data.reviewStatus = 503; await mock(page, baseURL!, data); await page.goto('/follow-up-access'); await revealFollowUpDetails(page); await page.getByRole('textbox', { name: 'Task title', exact: true }).fill('Retain this authorized edit'); await revealFollowUpDetails(page); await page.getByRole('button', { name: 'Approve task' }).click(); await expect(page.getByText('Temporary workflow failure', { exact: true })).toBeVisible(); await expect(page.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue('Retain this authorized edit'); expect(data.reviews).toHaveLength(1); data.reviewStatus = 200; await revealFollowUpDetails(page); await page.getByRole('button', { name: 'Approve task' }).click(); await expect(page.getByRole('link', { name: 'Open task' })).toBeVisible(); expect(data.reviews).toHaveLength(2); expect(data.reviews[1]).toMatchObject({ title: 'Retain this authorized edit' }); expect(data.sends).toEqual([]); expect(data.unexpected).toEqual([])
})
test('follow-up access preserves an authorized open draft on focus, then closes it on role loss', async ({ page, baseURL }, info) => {
  const data = state(); await page.setViewportSize({ width: 390, height: 844 }); await mock(page, baseURL!, data); await page.goto('/follow-up-access'); await page.getByRole('button', { name: 'Review email draft' }).click(); const subject = page.getByRole('textbox', { name: 'Subject', exact: true }); await subject.fill('Keep my authorized draft'); const before = data.reads; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect.poll(() => data.reads).toBeGreaterThan(before); await expect(subject).toHaveValue('Keep my authorized draft'); data.canWrite = false; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(page.getByRole('form')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Approve task' })).toHaveCount(0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath('follow-up-access-mobile.png'), fullPage: true }); expect(data.reviews).toEqual([]); expect(data.sends).toEqual([]); expect(data.unexpected).toEqual([])
})
test('follow-up access binds an explicit manual template send to its source and captured actor', async ({ page, baseURL }) => {
  const data = state(); await mock(page, baseURL!, data); await page.goto('/follow-up-access'); await page.getByRole('button', { name: 'Review email draft' }).click(); await expect(page.getByRole('form', { name: 'Compose email' })).toBeVisible(); expect(data.sends).toEqual([]); await page.getByRole('button', { name: 'Send email', exact: true }).click(); await expect(page.getByText('Email sent. Task review is tracked separately.', { exact: true })).toBeVisible(); expect(data.sends).toHaveLength(1); expect(data.sends[0]).toMatchObject({ leadId: coreIds.lead, followUpId: id, subject: 'Proposal' }); expect(data.sends[0]).not.toHaveProperty('draftVersion'); expect(data.reviews).toEqual([]); expect(data.unexpected).toEqual([])
})
test('follow-up access denies a stale-account response without displaying its private rows', async ({ page, baseURL }) => {
  const data = state(); data.stale = true; await mock(page, baseURL!, data); await page.goto('/follow-up-access'); await expect(page.getByText('Access changed. Reload before continuing.', { exact: true })).toBeVisible(); await expect(page.getByText('Private synthetic source', { exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Approve task' })).toHaveCount(0); expect(data.reviews).toEqual([]); expect(data.sends).toEqual([]); expect(data.unexpected).toEqual([])
})
