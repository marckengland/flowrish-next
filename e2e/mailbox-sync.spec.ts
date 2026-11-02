import { test, expect } from '@playwright/test'

test('mailbox health loads without requesting a sync', async ({ page }) => {
  let syncPosts = 0
  page.on('request', request => { if (request.url().endsWith('/api/email/sync') && request.method() === 'POST') syncPosts++ })
  const health = page.waitForResponse(response => response.url().endsWith('/api/email/sync') && response.request().method() === 'GET')
  await page.goto('/follow-ups')
  expect((await health).status()).toBe(200)
  await expect(page.getByRole('region', { name: 'Mailbox sync', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh sync status', exact: true })).toBeVisible()
  expect(syncPosts).toBe(0)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('shows a failed mailbox and queues only the explicitly selected provider', async ({ page }) => {
  let posts = 0
  const item = { id: 'synthetic-mailbox', email: 'rep@example.invalid', provider: 'microsoft', lastSyncAt: '2026-11-01T00:00:00.000Z', lastAttemptAt: '2026-11-02T00:00:00.000Z', requestedAt: null, status: 'failed', error: 'Sync could not complete. Reconnect this mailbox in Settings.', automatic: false }
  await page.route('**/api/email/sync', async route => {
    if (route.request().method() === 'POST') {
      posts++
      expect(route.request().postDataJSON()).toEqual({ provider: 'microsoft' })
      await route.fulfill({ json: { data: { accountId: item.id, status: 'queued' } } })
    } else await route.fulfill({ json: { data: [item], capabilities: { canWrite: true } } })
  })
  await page.goto('/follow-ups')
  const region = page.getByRole('region', { name: 'Mailbox sync', exact: true })
  await expect(region.getByRole('alert')).toContainText('Reconnect this mailbox')
  await expect(region.getByText('Last successful sync:', { exact: false })).toBeVisible()
  expect(posts).toBe(0)
  await region.getByRole('button', { name: 'Sync Microsoft 365 now', exact: true }).click()
  await expect(region.getByRole('status')).toContainText('Sync queued')
  await expect(region.getByRole('button', { name: 'Sync Microsoft 365 now', exact: true })).toBeDisabled()
  expect(posts).toBe(1)
})

test('mailbox health and manual sync require authentication', async ({ playwright, baseURL }) => {
  const external = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    expect((await external.get('/api/email/sync')).status()).toBe(401)
    expect((await external.post('/api/email/sync', { data: { provider: 'gmail' } })).status()).toBe(401)
  } finally { await external.dispose() }
})
