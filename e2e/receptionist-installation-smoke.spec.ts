import { expect, test } from '@playwright/test'
test('installation endpoint rejects invalid and unauthenticated checks before website traffic', async ({ page, browser, baseURL }) => {
  const path = '/api/admin/receptionist/setup/installation', headers = { Origin: new URL(baseURL!).origin }, data = { url: 'https://127.0.0.1/', expectedUpdatedAt: '2026-11-03T00:00:00.000Z' }
  const invalid = await page.request.post(path, { headers, data }); expect(invalid.status()).toBe(400); expect(invalid.headers()['cache-control']).toBe('no-store')
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } }); try { const response = await anonymous.request.post(new URL(path, baseURL).href, { headers, data }); expect(response.status()).toBe(401); expect(await response.json()).not.toHaveProperty('data') } finally { await anonymous.close() }
})
