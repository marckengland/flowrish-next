import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { renderWebsiteReceptionistHtml } from '../src/lib/website-receptionist-html'
const id = '11111111-1111-4111-8111-111111111111', parent = 'https://business.example', widget = 'https://widget.example', token = 'a'.repeat(64)
async function setup(page: Page, enabled: boolean, options: { holdFeedback?: boolean; expireCallback?: boolean } = {}) {
  const calls: { kind: string; body: Record<string, unknown> }[] = []; let attempts = 0, sessions = 0, activeToken = token
  let releaseFeedback: (status: number) => Promise<void> = async () => { throw new Error('No feedback request is pending') }
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === parent) { await route.fulfill({ contentType: 'text/html', body: `<html><body><script src="${widget}/receptionist-widget.js" data-flowrish-receptionist="${id}"></script></body></html>` }); return }
    if (url.origin === widget && ['/receptionist-widget.js', '/receptionist-widget-frame.js'].includes(url.pathname)) { await route.fulfill({ contentType: 'application/javascript', body: await readFile(path.join(process.cwd(), 'public', url.pathname), 'utf8') }); return }
    if (url.origin === widget && url.pathname.endsWith('/embed')) { await route.fulfill({ contentType: 'text/html', body: renderWebsiteReceptionistHtml({ publicId: id, businessName: 'Synthetic Repairs', siteOrigin: parent, allowedOrigins: [parent] }, '0123456789abcdef0123456789abcdef') }); return }
    if (url.origin === widget && request.method() === 'POST') {
      const kind = url.pathname.split('/').pop()!, body = request.postDataJSON(); calls.push({ kind, body }); expect(request.headers().cookie).toBeUndefined()
      if (kind === 'session') { sessions++; activeToken = sessions === 1 ? token : 'b'.repeat(64); await route.fulfill({ json: { data: { token: activeToken, businessName: 'Synthetic Repairs', greeting: 'How can we help?', expiresAt: new Date(Date.now() + 1800000).toISOString(), turn: 0, ...(enabled ? { feedbackEnabled: true } : {}) } } }); return }
      expect(request.headers().authorization).toBe(`Bearer ${activeToken}`)
      if (kind === 'message') { await route.fulfill({ json: { data: { reply: 'Please request a callback for an estimate.', turn: Number(body.expectedTurn) + 1, canMessage: true } } }); return }
      if (kind === 'feedback') { attempts++; if (options.holdFeedback && attempts === 1) { await new Promise<void>(done => { releaseFeedback = async status => { await route.fulfill({ status, json: status === 200 ? { data: { received: true } } : { error: { code: 'WEBSITE_SESSION_EXPIRED' } } }); done() } }); return }; if (attempts === 1) { await route.abort('failed'); return }; await route.fulfill({ json: { data: { received: true } } }); return }
      if (kind === 'callback' && options.expireCallback) { await route.fulfill({ status: 410, json: { error: { code: 'WEBSITE_SESSION_EXPIRED' } } }); return }
      if (kind === 'callback') { await route.fulfill({ json: { data: { received: true } } }); return }
    }
    throw new Error(`Unexpected network request: ${url.origin}${url.pathname}`)
  })
  await page.goto(parent); await page.getByRole('button', { name: 'Chat with us' }).click(); const frame = page.frameLocator('iframe'); await expect(frame.getByText('How can we help?')).toBeVisible()
  return { calls, frame, releaseFeedback: (status: number) => releaseFeedback(status) }
}
test('disabled feedback makes no extra requests and never offers question saving', async ({ page }) => {
  const { calls, frame } = await setup(page, false); await frame.getByLabel('Your question').fill('Repair estimate?'); await frame.getByRole('button', { name: 'Send question' }).click(); await expect(frame.getByText('Please request a callback for an estimate.')).toBeVisible(); await expect(frame.getByRole('button', { name: 'This didn’t help', exact: true })).toHaveCount(0); expect(calls.map(call => call.kind)).toEqual(['session', 'message'])
})
test('closing feedback sends nothing and can stop an uncertain retry without trapping the chat', async ({ page }) => {
  const { calls, frame } = await setup(page, true); await frame.getByLabel('Your question').fill('Repair cost?'); await frame.getByRole('button', { name: 'Send question' }).click(); await frame.getByRole('button', { name: 'This didn’t help', exact: true }).click()
  const close = frame.getByRole('button', { name: 'Close feedback', exact: true }); await expect(close).toBeVisible(); await close.click(); expect(calls.filter(call => call.kind === 'feedback')).toHaveLength(0)
  await frame.getByRole('button', { name: 'This didn’t help', exact: true }).click(); await frame.getByRole('checkbox', { name: /I agree to save this question/ }).check(); await frame.getByRole('button', { name: 'Save feedback', exact: true }).click(); await expect(frame.getByText(/could not confirm.*feedback/i)).toBeVisible(); await close.click(); await expect(frame.getByText(/may already have been saved/)).toBeVisible(); await expect(frame.getByLabel('Your question')).toBeEnabled()
  await frame.getByLabel('Your question').fill('Opening hours?'); await frame.getByRole('button', { name: 'Send question' }).click(); await expect.poll(() => calls.filter(call => call.kind === 'message').length).toBe(2); expect(calls.filter(call => call.kind === 'feedback')).toHaveLength(1)
})
for (const status of [200, 410]) {
  test(`ignores an earlier chat's delayed feedback ${status} after callback expiry and restart`, async ({ page }) => {
    const { calls, frame, releaseFeedback } = await setup(page, true, { holdFeedback: true, expireCallback: true })
    await frame.getByLabel('Your question').fill('Old question'); await frame.getByRole('button', { name: 'Send question' }).click(); await frame.getByRole('button', { name: 'This didn’t help', exact: true }).click(); await frame.getByRole('checkbox', { name: /I agree to save this question/ }).check(); await frame.getByRole('button', { name: 'Save feedback', exact: true }).click(); await expect.poll(() => calls.filter(call => call.kind === 'feedback').length).toBe(1)
    await frame.getByLabel('Full name', { exact: true }).fill('Synthetic Visitor'); await frame.getByLabel('Phone number', { exact: true }).fill('+12025550123'); await frame.getByLabel('What should the business know?', { exact: true }).fill('Callback'); await frame.getByRole('button', { name: 'Review callback request', exact: true }).click(); await frame.getByRole('checkbox', { name: /may contact me/ }).check(); await frame.getByRole('button', { name: 'Confirm callback request', exact: true }).click(); await frame.getByRole('button', { name: 'Start a new chat', exact: true }).click(); await expect(frame.getByLabel('Your question')).toBeEnabled()
    await frame.getByLabel('Your question').fill('New question'); await frame.getByRole('button', { name: 'Send question' }).click(); await frame.getByRole('button', { name: 'This didn’t help', exact: true }).click(); const response = page.waitForResponse(value => value.url().endsWith('/feedback')); await releaseFeedback(status); await (await response).finished(); const content = page.frames().find(value => value.url().startsWith(widget))!; await content.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    await expect(frame.locator('#feedback-form')).toBeVisible(); await expect(frame.getByLabel('Question to save', { exact: true })).toHaveValue('New question'); await expect(frame.getByRole('checkbox', { name: /I agree to save this question/ })).not.toBeChecked(); await expect(frame.getByLabel('Your question')).toBeEnabled()
  })
}
for (const mobile of [false, true]) {
  test(`requires reviewed question consent and safe explicit retries on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    const { calls, frame } = await setup(page, true); await expect(frame.getByRole('button', { name: 'This didn’t help', exact: true })).toHaveCount(0)
    await frame.getByLabel('Your question').fill('<img src=x> Can you repair bicycles?'); await frame.getByRole('button', { name: 'Send question' }).click(); await expect(frame.getByText('Please request a callback for an estimate.')).toBeVisible(); await frame.getByRole('button', { name: 'This didn’t help', exact: true }).click()
    const text = frame.getByLabel('Question to save', { exact: true }), consent = frame.getByRole('checkbox', { name: /I agree to save this question/ }), save = frame.getByRole('button', { name: 'Save feedback', exact: true })
    await expect(text).toHaveValue('<img src=x> Can you repair bicycles?'); await expect(save).toBeDisabled(); expect(calls.filter(call => call.kind === 'feedback')).toHaveLength(0)
    await consent.check(); await text.fill('Can you repair bicycles?'); await expect(consent).not.toBeChecked(); await consent.check(); await save.click(); await expect(frame.getByText(/could not confirm.*feedback/i)).toBeVisible(); expect(calls.filter(call => call.kind === 'feedback')).toHaveLength(1)
    await expect(text).toBeDisabled(); await save.click(); await expect(frame.getByText('Feedback saved for the business to review.', { exact: true })).toBeVisible()
    const submissions = calls.filter(call => call.kind === 'feedback'); expect(submissions).toHaveLength(2); expect(submissions[0].body).toEqual(submissions[1].body); expect(submissions[1].body).toEqual({ requestId: calls.find(call => call.kind === 'message')!.body.requestId, question: 'Can you repair bicycles?', consented: true, website: '' }); expect(calls.filter(call => call.kind === 'message')).toHaveLength(1)
    await expect(frame.getByRole('button', { name: 'This didn’t help', exact: true })).toHaveCount(0); await expect(frame.locator('img')).toHaveCount(0); await frame.getByLabel('Your question').fill('What services are offered?'); await frame.getByRole('button', { name: 'Send question' }).click(); await frame.getByRole('button', { name: 'This didn’t help', exact: true }).click(); await expect(consent).not.toBeChecked(); await expect(text).toHaveValue('What services are offered?'); expect(calls.filter(call => call.kind === 'feedback')).toHaveLength(2)
    const content = page.frames().find(value => value.url().startsWith(widget))!; expect(await content.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await text.scrollIntoViewIfNeeded(); await page.screenshot({ path: `/tmp/flowrish-feedback-widget-${mobile ? 'mobile' : 'desktop'}.png` })
    await frame.getByLabel('Full name', { exact: true }).fill('Synthetic Visitor'); await frame.getByLabel('Phone number', { exact: true }).fill('+12025550123'); await frame.getByLabel('What should the business know?', { exact: true }).fill('Repair callback'); await frame.getByRole('button', { name: 'Review callback request', exact: true }).click(); const callbackConsent = frame.getByRole('checkbox', { name: /may contact me/ }); await callbackConsent.check(); await frame.getByRole('button', { name: 'Confirm callback request', exact: true }).click(); await expect(frame.getByText('Your request was sent to the business for review.', { exact: true })).toBeVisible(); expect(calls.filter(call => call.kind === 'feedback')).toHaveLength(2)
  })
}
