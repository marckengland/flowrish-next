import { expect, test } from '@playwright/test'
import { feedbackListSchema, feedbackPolicySchema } from '../src/lib/visitor-feedback'
test('visitor feedback APIs are private, strictly scoped, no-store and default off without public consent writes', async ({ page, browser, baseURL }) => {
  const base = '/api/admin/website-receptionist', policy = await page.request.get(`${base}/feedback-policy`); expect(policy.status()).toBe(200); expect(policy.headers()['cache-control']).toBe('no-store'); expect(feedbackPolicySchema.safeParse((await policy.json()).data).success).toBe(true)
  const list = await page.request.get(`${base}/feedback`); expect(list.status()).toBe(200); expect(list.headers()['cache-control']).toBe('no-store'); expect(feedbackListSchema.safeParse((await list.json()).data).success).toBe(true); expect((await page.request.get(`${base}/feedback?organizationId=foreign`)).status()).toBe(400)
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } }); try { expect((await anonymous.request.get(new URL(`${base}/feedback`, baseURL).href)).status()).toBe(401) } finally { await anonymous.close() }
  const path = '/api/public/website-receptionist/11111111-1111-4111-8111-111111111111/feedback'; const denied = await page.request.post(path, { headers: { origin: new URL(baseURL!).origin }, data: { question: 'No consent', website: '' } }); expect(denied.status()).toBe(403); expect(denied.headers()['cache-control']).toBe('no-store'); expect(await denied.json()).not.toHaveProperty('data')
})
