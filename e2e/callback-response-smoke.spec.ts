import { expect, test } from '@playwright/test'
import { responsePolicyMetadataSchema, responseTargetListSchema } from '../src/lib/callback-response'
test('response targets expose only authenticated metadata without changing policy or data', async ({ page, browser }) => {
  for (const [path, schema] of [['/api/admin/callback-response-policy', responsePolicyMetadataSchema], ['/api/callback-response-targets?filter=all&page=1', responseTargetListSchema]] as const) { const response = await page.request.get(path); expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toBe('no-store'); expect(schema.safeParse((await response.json()).data).success).toBe(true) }
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } }); try { expect((await anonymous.request.get('/api/callback-response-targets')).status()).toBe(401) } finally { await anonymous.close() }
})
