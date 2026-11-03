import { expect, test } from '@playwright/test'
import { websiteCallbackListSchema } from '../src/lib/website-receptionist'
test('callback inbox reuses authenticated organization-scoped reads without configuration or writes', async ({ page, browser, baseURL }) => {
  const path = '/api/admin/website-receptionist/callbacks'
  const response = await page.request.get(`${path}?status=pending&page=1`); expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toBe('no-store'); expect(websiteCallbackListSchema.safeParse((await response.json()).data).success).toBe(true)
  expect((await page.request.get(`${path}?status=pending&page=1&organizationId=foreign`)).status()).toBe(400)
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try { const denied = await anonymous.request.get(new URL(`${path}?status=pending&page=1`, baseURL).href); expect(denied.status()).toBe(401); expect(await denied.json()).not.toHaveProperty('data') } finally { await anonymous.close() }
})
