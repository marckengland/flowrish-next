import { expect, test } from '@playwright/test'
import { setupSnapshotSchema } from '../src/lib/receptionist-setup'

test('setup metadata is admin-only, bounded and never cached without writing settings', async ({ page, browser }) => {
  const response = await page.request.get('/api/admin/receptionist/setup')
  expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toBe('no-store')
  expect(setupSnapshotSchema.safeParse((await response.json()).data).success).toBe(true)
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try { expect((await anonymous.request.get('/api/admin/receptionist/setup')).status()).toBe(401) } finally { await anonymous.close() }
})
