import { expect, test } from '@playwright/test'

test('shows the readable DeepSeek name without reading or using saved credentials', async ({ page }) => {
 const requests: string[] = []
 await page.route('**/api/admin/ai-provider**', async route => {
  const request = route.request()
  requests.push(request.method() + ' ' + new URL(request.url()).pathname)
  if (request.method() !== 'GET' || new URL(request.url()).pathname !== '/api/admin/ai-provider') return route.abort('blockedbyclient')
  return route.fulfill({ json: { data: {
   config: { provider: 'deepseek', model: 'deepseek-flash', enabled: true, hasKey: true, dailyRequestLimit: 20, dailyTokenLimit: 50000, maxOutputTokens: 2048, maxInputBytes: 16000, updatedAt: '2026-11-02T00:00:00.000Z' },
   usage: { day: '2026-11-02', requests: 0, reservedTokens: 0, reportedTokens: 0, completedRequests: 0, failedRequests: 0 }, platformAvailable: false,
  } } })
 })
 await page.goto('/settings')
 await page.getByRole('button', { name: 'AI provider', exact: true }).click()
 await expect(page.getByText('DeepSeek V4.1 Flash', { exact: true })).toBeVisible()
 await expect(page.getByLabel('Model', { exact: true })).toHaveValue('deepseek-flash')
 await expect(page.getByLabel('Model', { exact: true })).toHaveAccessibleDescription(/DeepSeek V4.1 Flash/)
 await expect(page.getByLabel('API key', { exact: true })).toHaveValue('')
 await page.getByLabel('Model', { exact: true }).fill('deepseek-v4-pro')
 await expect(page.getByText('DeepSeek V4.1 Flash', { exact: true })).toHaveCount(0)
 await page.getByLabel('Model', { exact: true }).fill('deepseek-flash')
 await expect(page.getByText('DeepSeek V4.1 Flash', { exact: true })).toBeVisible()
 await page.setViewportSize({ width: 390, height: 844 })
 await expect(page.getByRole('complementary', { name: 'Primary navigation' })).not.toBeInViewport()
 await page.getByText('DeepSeek V4.1 Flash', { exact: true }).scrollIntoViewIfNeeded()
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
 await page.screenshot({ path: '/tmp/flowrish-deepseek-model-label.png', fullPage: true })
 expect(requests).toEqual(['GET /api/admin/ai-provider'])
})
