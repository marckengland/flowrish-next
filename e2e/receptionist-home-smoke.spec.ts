import { expect, test } from '@playwright/test'
import { receptionistHomeSchema } from '../src/lib/receptionist-home'
test('Receptionist home GET is private, session-scoped and read-only', async ({ page, browser, baseURL }) => {
  const response = await page.request.get('/api/receptionist/home'); expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toBe('no-store')
  const data = (await response.json()).data; expect(receptionistHomeSchema.safeParse(data).success).toBe(true); expect(JSON.stringify(data)).not.toMatch(/apiKey|Ciphertext|fullName|phone|reason|notes|transcript/)
  for (const query of ['organizationId=foreign', 'userId=foreign', 'refresh=true']) { const invalid = await page.request.get(`/api/receptionist/home?${query}`); expect(invalid.status()).toBe(400); expect(invalid.headers()['cache-control']).toBe('no-store') }
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try { const denied = await anonymous.request.get(new URL('/api/receptionist/home', baseURL).href); expect(denied.status()).toBe(401); expect(await denied.json()).not.toHaveProperty('data') } finally { await anonymous.close() }
})
