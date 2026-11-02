import { expect, test, type Page, type Request } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { renderWebsiteReceptionistHtml } from '../src/lib/website-receptionist-html'

const id = '550e8400-e29b-41d4-a716-446655440000'
const token = 'a'.repeat(64)
const parentOrigin = 'https://customer.example'
const widgetOrigin = 'https://widget.example'
const name = '<script>alert("business")</script> Family Clinic'
const embed = renderWebsiteReceptionistHtml({ publicId: id, businessName: name, siteOrigin: parentOrigin, allowedOrigins: [parentOrigin] }, '0123456789abcdef0123456789abcdef')
type Call = { path: string; body: Record<string, unknown>; authorization: string | undefined; cookie: string | undefined }

async function setup(page: Page, respond?: (request: Request, call: Call, calls: Call[]) => { status?: number; data?: unknown; abort?: boolean } | undefined) {
  const calls: Call[] = []
  const assetRequests: string[] = []
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === parentOrigin) {
      await route.fulfill({ contentType: 'text/html', body: `<html><body><h1>Customer website</h1><script src="${widgetOrigin}/receptionist-widget.js" data-flowrish-receptionist="${id}"></script></body></html>` })
    } else if (url.origin === widgetOrigin && ['/receptionist-widget.js', '/receptionist-widget-frame.js'].includes(url.pathname)) {
      assetRequests.push(url.pathname)
      await route.fulfill({ contentType: 'application/javascript', body: await readFile(path.join(process.cwd(), 'public', url.pathname), 'utf8') })
    } else if (url.origin === widgetOrigin && url.pathname.endsWith('/embed')) {
      assetRequests.push(url.pathname)
      await route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': "default-src 'none'; script-src 'nonce-0123456789abcdef0123456789abcdef'; style-src 'nonce-0123456789abcdef0123456789abcdef'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://customer.example" }, body: embed })
    } else if (url.origin === widgetOrigin && request.method() === 'POST') {
      const call = { path: url.pathname.split('/').pop()!, body: request.postDataJSON(), authorization: request.headers().authorization, cookie: request.headers().cookie }
      calls.push(call)
      const result = respond?.(request, call, calls)
      if (result?.abort) { await route.abort('failed'); return }
      const defaults = call.path === 'session'
        ? { token, businessName: name, greeting: 'Hello. How can I help?', expiresAt: new Date(Date.now() + 1800000).toISOString(), turn: 0 }
        : call.path === 'message' ? { reply: '<script>alert("reply")</script> We open at 9.', turn: Number(call.body.expectedTurn) + 1, canMessage: true } : { received: true }
      await route.fulfill({ status: result?.status ?? 200, contentType: 'application/json', body: JSON.stringify(result?.data ?? { data: defaults }) })
    } else {
      throw new Error(`Unexpected external request: ${url.origin}${url.pathname}`)
    }
  })
  await page.goto(parentOrigin)
  const frame = page.frameLocator('iframe[title="Business website assistant"]')
  return { calls, assetRequests, frame }
}

test('defers iframe/session until open, isolates data, and renders model text literally', async ({ page }) => {
  const { calls, assetRequests, frame } = await setup(page)
  await expect(page.getByRole('button', { name: 'Chat with us' })).toBeVisible()
  expect(calls).toEqual([])
  expect(assetRequests).toEqual(['/receptionist-widget.js'])
  await page.getByRole('button', { name: 'Chat with us' }).click()
  await expect(frame.getByRole('heading', { name })).toBeVisible()
  await expect(frame.getByText('Hello. How can I help?')).toBeVisible()
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({ path: 'session', body: { siteOrigin: parentOrigin, website: '' } })
  const iframe = page.locator('iframe')
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')
  await frame.getByLabel('Your question').fill('<script>alert("visitor")</script> When do you open?')
  await frame.getByRole('button', { name: 'Send question' }).click()
  await expect(frame.getByText('<script>alert("reply")</script> We open at 9.')).toBeVisible()
  await expect(frame.locator('script:not([src]):not([type="application/json"])')).toHaveCount(0)
  expect(calls[1]).toMatchObject({ path: 'message', body: { expectedTurn: 0, history: [], website: '' }, authorization: `Bearer ${token}` })
  expect(calls.every(call => call.cookie === undefined)).toBe(true)
  expect(await page.context().cookies()).toEqual([])
  for (const item of page.frames()) {
    expect(await item.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0])
  }
  await page.getByRole('button', { name: 'Close chat' }).click()
  await expect(iframe).toBeHidden()
  await expect(page.getByRole('button', { name: 'Chat with us' })).toBeFocused()
})

test('rejects forged handshakes and direct navigation without starting a session', async ({ page }) => {
  const { calls } = await setup(page)
  await page.goto(`${widgetOrigin}/api/public/website-receptionist/${id}/embed?origin=${encodeURIComponent(parentOrigin)}`)
  await page.evaluate(origin => {
    window.dispatchEvent(new MessageEvent('message', { origin, source: window, data: { type: 'flowrish-receptionist:init' } }))
  }, parentOrigin)
  await expect(page.getByRole('button', { name: 'Send question' })).toBeDisabled()
  expect(calls).toEqual([])
})

test('manual message retry preserves request identity and advances only acknowledged history', async ({ page }) => {
  let attempts = 0
  const { calls, frame } = await setup(page, (_request, call) => {
    if (call.path === 'message' && ++attempts === 1) return { abort: true }
  })
  await page.getByRole('button', { name: 'Chat with us' }).click()
  await expect(frame.getByText('Hello. How can I help?')).toBeVisible()
  await frame.getByLabel('Your question').fill('Hours?')
  await frame.getByRole('button', { name: 'Send question' }).click()
  await expect(frame.getByRole('button', { name: 'Retry last question' })).toBeVisible()
  expect(calls.filter(call => call.path === 'message')).toHaveLength(1)
  await frame.getByRole('button', { name: 'Retry last question' }).click()
  await expect(frame.getByText('<script>alert("reply")</script> We open at 9.')).toBeVisible()
  expect(calls[1].body).toEqual(calls[2].body)
  await frame.getByLabel('Your question').fill('Address?')
  await frame.getByRole('button', { name: 'Send question' }).click()
  await expect.poll(() => calls.length).toBe(4)
  expect(calls[3].body).toMatchObject({ expectedTurn: 1, question: 'Address?', history: ['Hours?'] })
  expect(calls[3].body.requestId).not.toBe(calls[1].body.requestId)
})

test('requires callback readback and fresh consent after edits, submits once without AI', async ({ page }) => {
  const { calls, frame } = await setup(page)
  await page.getByRole('button', { name: 'Chat with us' }).click()
  await expect(frame.getByText('Hello. How can I help?')).toBeVisible()
  await frame.getByLabel('Full name').fill('<script>Person</script>')
  await frame.getByLabel('Phone number').fill('+639171234567')
  await frame.getByLabel('What should the business know?').fill('Please call about services.')
  await frame.getByRole('button', { name: 'Review callback request' }).click()
  await expect(frame.getByRole('button', { name: 'Confirm callback request' })).toBeDisabled()
  await expect(frame.getByText('<script>Person</script>', { exact: true })).toBeVisible()
  await frame.getByRole('checkbox').check()
  await frame.getByLabel('Full name').fill('Corrected Person')
  await expect(frame.getByRole('button', { name: 'Confirm callback request' })).toBeHidden()
  await frame.getByRole('button', { name: 'Review callback request' }).click()
  await expect(frame.getByRole('checkbox')).not.toBeChecked()
  await frame.getByRole('checkbox').check()
  await frame.getByRole('button', { name: 'Confirm callback request' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect(frame.getByText('Your request was sent to the business for review.')).toBeVisible()
  expect(calls.map(call => call.path)).toEqual(['session', 'callback'])
  expect(calls[1].body).toEqual({ fullName: 'Corrected Person', phone: '+639171234567', reason: 'Please call about services.', confirmed: true, website: '' })
})

test('expiry requires explicit new chat and preserves callback draft; small screens do not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  const { calls, frame } = await setup(page, (_request, call) => call.path === 'message' ? { status: 410, data: { error: { message: 'SECRET PROVIDER DETAILS' } } } : undefined)
  await page.getByRole('button', { name: 'Chat with us' }).click()
  await expect(frame.getByText('Hello. How can I help?')).toBeVisible()
  await frame.getByLabel('Full name').fill('Saved draft')
  await frame.getByLabel('Your question').fill('Hello')
  await frame.getByRole('button', { name: 'Send question' }).click()
  await expect(frame.getByRole('button', { name: 'Start a new chat' })).toBeVisible()
  expect(calls).toHaveLength(2)
  await expect(frame.getByText('SECRET PROVIDER DETAILS')).toHaveCount(0)
  await frame.getByRole('button', { name: 'Start a new chat' }).click()
  await expect.poll(() => calls.length).toBe(3)
  await expect(frame.getByLabel('Full name')).toHaveValue('Saved draft')
  const box = await page.locator('iframe').boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(320)
  expect(await page.frames()[1].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('frame checks both parent source and origin before requesting a session', async ({ page }) => {
  const { calls, frame } = await setup(page)
  await page.route(`${parentOrigin}/`, route => route.fulfill({ contentType: 'text/html', body: `<iframe title="Business website assistant" sandbox="allow-scripts allow-same-origin" src="${widgetOrigin}/api/public/website-receptionist/${id}/embed?origin=${encodeURIComponent(parentOrigin)}"></iframe>` }))
  await page.goto(parentOrigin)
  await expect(frame.getByRole('heading', { name })).toBeVisible()
  const child = page.frames()[1]
  await child.evaluate(origin => {
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', source: window.parent, data: { type: 'flowrish-receptionist:init' } }))
    window.dispatchEvent(new MessageEvent('message', { origin, source: window, data: { type: 'flowrish-receptionist:init' } }))
  }, parentOrigin)
  await expect(frame.getByRole('button', { name: 'Send question' })).toBeDisabled()
  expect(calls).toEqual([])
  await page.evaluate(origin => document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'flowrish-receptionist:init' }, origin), widgetOrigin)
  await expect(frame.getByText('Hello. How can I help?')).toBeVisible()
  expect(calls.map(call => call.path)).toEqual(['session'])
})

test('loader only sends init to its own iframe at the script origin and never includes secrets', async ({ page }) => {
  const { calls, frame } = await setup(page)
  await page.route(`${widgetOrigin}/receptionist-widget-frame.js`, route => route.fulfill({ contentType: 'application/javascript', body: `window.received = []; window.addEventListener('message', event => window.received.push(event.data));` }))
  await page.getByRole('button', { name: 'Chat with us' }).click()
  await expect(frame.locator('#business-name')).toBeVisible()
  const child = page.frames()[1]
  await page.evaluate(origin => {
    window.dispatchEvent(new MessageEvent('message', { origin, source: window, data: { type: 'flowrish-receptionist:ready' } }))
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', source: document.querySelector('iframe')!.contentWindow, data: { type: 'flowrish-receptionist:ready' } }))
  }, widgetOrigin)
  expect(await child.evaluate(() => (window as unknown as { received: unknown[] }).received)).toEqual([])
  await page.evaluate(origin => {
    window.dispatchEvent(new MessageEvent('message', { origin, source: document.querySelector('iframe')!.contentWindow, data: { type: 'flowrish-receptionist:ready' } }))
  }, widgetOrigin)
  await expect.poll(() => child.evaluate(() => (window as unknown as { received: unknown[] }).received)).toEqual([{ type: 'flowrish-receptionist:init' }])
  expect(calls).toEqual([])
})

test('session token never enters parent messages or either page DOM', async ({ page }) => {
  await page.addInitScript(() => {
    const messages: unknown[] = []
    ;(window as unknown as { received: unknown[] }).received = messages
    window.addEventListener('message', event => messages.push(event.data))
  })
  const { frame } = await setup(page)
  await page.getByRole('button', { name: 'Chat with us' }).click()
  await expect(frame.getByText('Hello. How can I help?')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { received: unknown[] }).received)).toEqual([{ type: 'flowrish-receptionist:ready' }])
  for (const item of page.frames()) {
    expect(await item.evaluate(() => document.documentElement.outerHTML)).not.toContain(token)
    expect(await item.evaluate(() => JSON.stringify((window as unknown as { received: unknown[] }).received))).not.toContain(token)
  }
})

test('409 and quota responses show static guidance and never automatically resend', async ({ page }) => {
  let attempts = 0
  const { calls, frame } = await setup(page, (_request, call) => {
    if (call.path !== 'message') return
    attempts++
    return { status: attempts === 1 ? 409 : 429, data: { error: { message: '<script>provider secret</script>', code: 'WEBSITE_TOO_EARLY' } } }
  })
  await page.getByRole('button', { name: 'Chat with us' }).click()
  await expect(frame.getByText('Hello. How can I help?')).toBeVisible()
  await frame.getByLabel('Your question').fill('Question')
  await frame.getByRole('button', { name: 'Send question' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect(frame.getByText('Your previous request is still being processed. Wait a moment, then retry the same request.')).toBeVisible()
  expect(calls.map(call => call.path)).toEqual(['session', 'message'])
  await frame.getByRole('button', { name: 'Retry last question' }).click()
  await expect(frame.getByText('Please wait before trying again. The business may have reached its daily limit.')).toBeVisible()
  expect(calls).toHaveLength(3)
  expect(calls[1].body).toEqual(calls[2].body)
  await expect(frame.getByText('<script>provider secret</script>')).toHaveCount(0)
  await expect(frame.getByRole('button', { name: 'Review callback request' })).toBeEnabled()
})

test('callback network retry preserves the reviewed payload and locks unresolved edits', async ({ page }) => {
  let attempts = 0
  const { calls, frame } = await setup(page, (_request, call) => {
    if (call.path === 'callback' && ++attempts === 1) return { abort: true }
  })
  await page.getByRole('button', { name: 'Chat with us' }).click()
  await expect(frame.getByText('Hello. How can I help?')).toBeVisible()
  await frame.getByLabel('Full name').fill('Callback Person')
  await frame.getByLabel('Phone number').fill('+639171234567')
  await frame.getByLabel('What should the business know?').fill('Please call about services.')
  await frame.getByRole('button', { name: 'Review callback request' }).click()
  await frame.getByRole('checkbox').check()
  await frame.getByRole('button', { name: 'Confirm callback request' }).click()
  await expect(frame.getByText('We could not confirm the response. You can retry, or contact the business directly.')).toBeVisible()
  await expect(frame.getByLabel('Full name')).toBeDisabled()
  await frame.getByRole('button', { name: 'Confirm callback request' }).click()
  await expect(frame.getByText('Your request was sent to the business for review.')).toBeVisible()
  expect(calls.map(call => call.path)).toEqual(['session', 'callback', 'callback'])
  expect(calls[1].body).toEqual(calls[2].body)
})

test('history includes at most four acknowledged user questions and stays within the byte cap', async ({ page }) => {
  const { calls, frame } = await setup(page)
  await page.getByRole('button', { name: 'Chat with us' }).click()
  await expect(frame.getByText('Hello. How can I help?')).toBeVisible()
  const questions = Array.from({ length: 6 }, (_value, index) => `${index}${'é'.repeat(600)}`)
  for (let index = 0; index < questions.length; index++) {
    await frame.getByLabel('Your question').fill(questions[index])
    await frame.getByRole('button', { name: 'Send question' }).click()
    await expect.poll(() => calls.length).toBe(index + 2)
    const call = calls[index + 1]
    expect(call.body.expectedTurn).toBe(index)
    const history = call.body.history as string[]
    expect(history.length).toBeLessThanOrEqual(4)
    expect(Buffer.byteLength(history.join('\n'), 'utf8')).toBeLessThanOrEqual(4000)
    expect(history.every(value => questions.slice(0, index).includes(value))).toBe(true)
  }
  await expect(frame.getByRole('button', { name: 'Send question' })).toBeDisabled()
  await expect(frame.getByRole('button', { name: 'Review callback request' })).toBeEnabled()
})

test('existing application cookies are omitted from widget API requests', async ({ page }) => {
  await page.context().addCookies([{ name: 'application-session', value: 'synthetic-test-cookie', url: widgetOrigin, secure: true, sameSite: 'None' }])
  const { calls, frame } = await setup(page)
  await page.getByRole('button', { name: 'Chat with us' }).click()
  await expect(frame.getByText('Hello. How can I help?')).toBeVisible()
  await frame.getByLabel('Your question').fill('Hours?')
  await frame.getByRole('button', { name: 'Send question' }).click()
  await expect(frame.getByText('<script>alert("reply")</script> We open at 9.')).toBeVisible()
  expect(calls.every(call => call.cookie === undefined)).toBe(true)
  expect((await page.context().cookies()).map(cookie => cookie.name)).toEqual(['application-session'])
})

test('mobile callback review remains readable and keyboard accessible', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 740 })
  const { frame } = await setup(page)
  await page.getByRole('button', { name: 'Chat with us' }).click()
  await expect(frame.getByText('Hello. How can I help?')).toBeVisible()
  await frame.getByLabel('Full name').fill('Maria Santos')
  await frame.getByLabel('Phone number').fill('+639171234567')
  await frame.getByLabel('What should the business know?').fill('Please call me about your opening hours.')
  await frame.getByRole('button', { name: 'Review callback request' }).focus()
  await page.keyboard.press('Enter')
  await expect(frame.getByRole('heading', { name: 'Review your request' })).toBeVisible()
  await frame.getByRole('checkbox').focus()
  await page.keyboard.press('Space')
  await expect(frame.getByRole('button', { name: 'Confirm callback request' })).toBeEnabled()
  await frame.getByRole('button', { name: 'Confirm callback request' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('callback-review-mobile.png') })
  await page.getByRole('button', { name: 'Close chat' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Chat with us' })).toBeFocused()
})

test('closed chat stops pending retries but keeps callback consent and explicit restart available', async ({ page }) => {
  const { calls, frame } = await setup(page, (_request, call) => call.path === 'message'
    ? { status: 409, data: { error: { code: 'WEBSITE_CHAT_CLOSED', message: 'SECRET provider error detail' } } }
    : undefined)
  await page.getByRole('button', { name: 'Chat with us' }).click()
  await expect(frame.getByText('Hello. How can I help?')).toBeVisible()
  await frame.getByLabel('Your question').fill('Question interrupted by a closed chat')
  await frame.getByRole('button', { name: 'Send question' }).click()
  await expect(frame.getByRole('button', { name: 'Start a new chat' })).toBeVisible()
  await expect(frame.getByRole('button', { name: 'Send question' })).toBeDisabled()
  await expect(frame.getByRole('button', { name: 'Retry last question' })).toBeHidden()
  await expect(frame.getByText('SECRET provider error detail')).toHaveCount(0)
  expect(calls.map(call => call.path)).toEqual(['session', 'message'])
  await frame.getByLabel('Full name').fill('Callback Person')
  await frame.getByLabel('Phone number').fill('+639171234567')
  await frame.getByLabel('What should the business know?').fill('Please call about services.')
  await frame.getByRole('button', { name: 'Review callback request' }).click()
  await frame.getByRole('checkbox').check()
  await frame.getByRole('button', { name: 'Confirm callback request' }).click()
  await expect(frame.getByText('Your request was sent to the business for review.')).toBeVisible()
  expect(calls.map(call => call.path)).toEqual(['session', 'message', 'callback'])
  await frame.getByRole('button', { name: 'Start a new chat' }).click()
  await expect(frame.getByRole('button', { name: 'Send question' })).toBeEnabled()
  expect(calls.map(call => call.path)).toEqual(['session', 'message', 'callback', 'session'])
})
