import {revealFollowUpDetails} from './helpers/follow-up-details'
import { test, expect } from '@playwright/test'

test('generates a contextual draft and sends only after explicit review and Send', async ({ page }) => {
  const id = '11111111-1111-4111-8111-111111111111'
  const version = '22222222-2222-4222-8222-222222222222'
  const item = { id, sourceType: 'EMAIL', sourceText: 'Could we meet Thursday?', title: 'Follow up', description: 'Review scheduling', draftSubject: 'Scheduling', draftBody: 'Template', status: 'PENDING', taskId: null, lead: { id: '33333333-3333-4333-8333-333333333333', firstName: 'Jane', lastName: 'Smith', email: 'primary@example.invalid' }, createdAt: '2026-11-02T00:00:00.000Z' }
  const draft = { id, subject: 'Re: Scheduling', body: 'Hi Jane,\nWould Thursday at 2 PM work for you?', generatedAt: '2026-11-02T01:00:00.000Z', version, context: { accountId: '44444444-4444-4444-8444-444444444444', mailboxEmail: 'owner@example.invalid', provider: 'gmail', recipientEmail: 'alternate@example.invalid', threadId: 'source-thread', messageCount: 4, lastMessageAt: '2026-11-02T00:00:00.000Z' } }
  let generated = 0
  let sent = 0
  await page.route('**/api/email/send', async route => {
    sent++
    expect(route.request().postDataJSON()).toMatchObject({ leadId: item.lead.id, followUpId: id, draftVersion: version, threadId: 'source-thread' })
    await route.fulfill({ json: { data: { messageId: 'synthetic-message', threadId: 'source-thread', attachmentCount: 0 } } })
  })
  await page.route('**/api/email/test', async () => { throw new Error('Contextual drafting must never send a test email') })
  await page.route('**/api/follow-ups**', async route => {
    if (route.request().url().endsWith('/draft')) {
      generated++
      expect(route.request().postDataJSON()).toEqual({ instructions: 'Suggest Thursday afternoon.' })
      await route.fulfill({ json: { data: draft } })
    } else await route.fulfill({ json: { data: [item] } })
  })
  await page.goto('/follow-ups')
  await revealFollowUpDetails(page); await page.getByRole('textbox', { name: 'Draft instructions', exact: true }).fill('Suggest Thursday afternoon.')
  expect(generated).toBe(0)
  await revealFollowUpDetails(page); await page.getByRole('button', { name: 'Generate contextual draft', exact: true }).click()
  await expect(page.getByText(/Generated from 4 messages/)).toBeVisible()
  expect(sent).toBe(0)
  await page.getByRole('button', { name: 'Review email draft', exact: true }).click()
  await expect(page.getByRole('form', { name: 'Reply email', exact: true })).toContainText('alternate@example.invalid')
  await expect(page.getByRole('button', { name: 'Send test email', exact: true })).toHaveCount(0)
  expect(sent).toBe(0)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Send reply', exact: true }).click()
  await expect(page.getByText('Email sent. Task review is tracked separately.')).toBeVisible()
  expect(generated).toBe(1)
  expect(sent).toBe(1)
})

test('conversation draft generation requires authentication', async ({ playwright, baseURL }) => {
  const external = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try { expect((await external.post('/api/follow-ups/11111111-1111-4111-8111-111111111111/draft', { data: {} })).status()).toBe(401) }
  finally { await external.dispose() }
})
