import {revealFollowUpDetails} from './helpers/follow-up-details'
import { test, expect } from '@playwright/test'

test.setTimeout(60_000)

test('follow-up inbox loads with accessible history and fits a mobile screen', async ({ page }) => {
  const response = page.waitForResponse(r => r.url().includes('/api/follow-ups') && r.request().method() === 'GET')
  await page.goto('/follow-ups')
  expect((await response).status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Follow-up inbox', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Pending', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Approved', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Dismissed', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('follow-up inbox APIs require authentication', async ({ playwright, baseURL }) => {
  const external = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    expect((await external.get('/api/follow-ups')).status()).toBe(401)
    expect((await external.patch('/api/follow-ups/11111111-1111-4111-8111-111111111111', { data: { action: 'approve' } })).status()).toBe(401)
  } finally { await external.dispose() }
})

test('reviews a synthetic reply, approves edited task once, and never sends implicitly', async ({ page }) => {
  const item = { id: 'synthetic-review', sourceType: 'EMAIL', sourceText: 'Could you call tomorrow? <script>alert(1)</script>', title: 'Follow up with Jane', description: 'Review the incoming reply.', draftSubject: 'Following up', draftBody: 'Hello Jane,\nThanks for your reply.', status: 'PENDING', taskId: null, lead: { id: 'synthetic-lead', firstName: 'Jane', lastName: 'Smith', email: 'jane@example.invalid' }, createdAt: '2026-11-02T00:00:00.000Z' }
  let approvals = 0
  let sends = 0
  await page.route('**/api/email/send', async route => { sends++; await route.abort() })
  await page.route('**/api/follow-ups**', async route => {
    if (route.request().method() === 'PATCH') {
      approvals++
      const input = route.request().postDataJSON()
      expect(input).toMatchObject({ action: 'approve', title: 'Call Jane tomorrow', description: 'Ask about the proposal.' })
      await route.fulfill({ json: { data: { ...item, ...input, status: 'APPROVED', taskId: 'synthetic-task' } } })
    } else await route.fulfill({ json: { data: [item] } })
  })
  await page.goto('/follow-ups')
  await revealFollowUpDetails(page); await page.getByLabel('Task title', { exact: true }).fill('Call Jane tomorrow')
  await revealFollowUpDetails(page); await page.getByRole('textbox', { name: 'Task description', exact: true }).fill('Ask about the proposal.')
  await revealFollowUpDetails(page); await page.getByRole('button', { name: 'Approve task', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Open task', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve task', exact: true })).toHaveCount(0)
  expect(approvals).toBe(1)
  expect(sends).toBe(0)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
