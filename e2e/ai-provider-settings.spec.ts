import { expect, test } from '@playwright/test'

test('organization AI settings save safely, test explicitly, and fit a narrow screen', async ({ page }, testInfo) => {
  let saved = false
  let tests = 0
  const usage = { day: '2026-11-02', requests: 0, reservedTokens: 0, reportedTokens: 0, completedRequests: 0, failedRequests: 0 }
  let config: Record<string, unknown> | null = null
  await page.route('**/api/admin/ai-provider**', async (route) => {
    if (route.request().url().endsWith('/test')) {
      tests += 1
      expect(route.request().postDataJSON()).toEqual({ expectedUpdatedAt: '2026-11-02T00:00:00.000Z' })
      await route.fulfill({ json: { data: { ok: true } } })
      return
    }
    if (route.request().method() === 'PUT') {
      const { apiKey, expectedUpdatedAt, ...settings } = route.request().postDataJSON()
      expect(apiKey).toBe('fixture-browser-key-not-real')
      expect(expectedUpdatedAt).toBeNull()
      config = { ...settings, hasKey: true, updatedAt: '2026-11-02T00:00:00.000Z' }
      saved = true
    }
    await route.fulfill({ json: { data: { config, usage, platformAvailable: true } } })
  })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'AI provider', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Organization AI provider', exact: true })).toBeVisible()
  const key = page.getByLabel('API key', { exact: true })
  await expect(key).toHaveAttribute('type', 'password')
  await expect(key).toHaveAttribute('autocomplete', 'new-password')
  await expect(page.getByRole('button', { name: 'Test saved connection' })).toBeDisabled()
  await key.fill('fixture-browser-key-not-real')
  await page.getByRole('button', { name: 'Save AI provider' }).click()
  await expect(page.getByRole('status')).toContainText('AI provider settings saved.')
  await expect(key).toHaveValue('')
  expect(saved).toBe(true)
  expect(tests).toBe(0)
  await page.getByRole('button', { name: 'Test saved connection' }).click()
  await expect(page.getByRole('status')).toContainText('Connection test succeeded.')
  expect(tests).toBe(1)
  await page.getByRole('heading', { name: 'Organization AI provider', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('ai-provider-desktop.png'), fullPage: true })
  await key.fill('fixture-another-provider-not-real')
  await page.getByLabel('Provider', { exact: true }).selectOption('gemini')
  await expect(key).toHaveValue('')
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gemini-3.1-flash-lite')
  await expect(page.getByText('Enter a new key for this provider.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Test saved connection' })).toBeDisabled()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('complementary', { name: 'Primary navigation' })).not.toBeInViewport()
  await page.getByRole('heading', { name: 'Organization AI provider', exact: true }).scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('ai-provider-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: 'AI prompts', exact: true }).click()
  await page.getByRole('button', { name: 'AI provider', exact: true }).click()
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('')
  expect(tests).toBe(1)
})
