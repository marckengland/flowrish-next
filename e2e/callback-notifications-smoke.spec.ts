import { expect, test } from '@playwright/test'
import { callbackNotificationCount, callbackNotificationList } from '../src/lib/callback-notifications'
test('notification APIs are authenticated, private and read-only on GET', async ({ page, browser }) => {
  for (const [path, schema] of [['/api/callback-notifications/count', callbackNotificationCount], ['/api/callback-notifications?filter=all&page=1', callbackNotificationList]] as const) {
    const response = await page.request.get(path); expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toBe('no-store'); expect(schema.safeParse((await response.json()).data).success).toBe(true)
  }
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try { expect((await anonymous.request.get('/api/callback-notifications/count')).status()).toBe(401) } finally { await anonymous.close() }
})
