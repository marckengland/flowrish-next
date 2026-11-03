import { expect, test } from '@playwright/test'
import { performanceReportSchema } from '../src/lib/callback-performance'
test('performance GET is authenticated, private, strictly scoped and read-only', async ({ page, browser }) => {
  const response = await page.request.get('/api/callback-performance'); expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toBe('no-store'); const data = (await response.json()).data; expect(performanceReportSchema.safeParse(data).success).toBe(true); expect(JSON.stringify(data)).not.toMatch(/apiKey|Ciphertext|fullName|phone|reason|notes|transcript/)
  expect((await page.request.get('/api/callback-performance?organizationId=foreign')).status()).toBe(400)
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } }); try { expect((await anonymous.request.get('/api/callback-performance')).status()).toBe(401) } finally { await anonymous.close() }
})
