import { expect, test } from '@playwright/test'
import type { WebsiteCallbackRecord, WebsiteReceptionistSettings } from '../src/lib/website-receptionist'

const owner = '44444444-4444-4444-8444-444444444444'
const stage = '55555555-5555-4555-8555-555555555555'
const publicId = '11111111-1111-4111-8111-111111111111'
const time = '2026-11-03T00:00:00.000Z'
const nextTime = '2026-11-03T00:01:00.000Z'
const phoneSettings = {
  config: { enabled: false, businessName: 'Synthetic Bicycle Repairs', knowledge: '', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: owner, stageId: stage },
  businessName: 'Synthetic Workspace', currentUserId: owner,
  members: [{ id: owner, name: 'Preview owner' }], stages: [{ id: stage, name: 'New', pipeline: { name: 'Sales' } }], calls: [], webhookPath: '/api/voice/receptionist/test',
}

for (const mobile of [false, true]) {
  test(`controls website receptionist spending and callback review on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    let settings: WebsiteReceptionistSettings | null = null
    let configReads = 0, saves = 0, callbackReads = 0, reviews = 0, dismissals = 0, deletions = 0
    const unexpected: string[] = []
    let callbacks: WebsiteCallbackRecord[] = [
      { id: '22222222-2222-4222-8222-222222222222', fullName: 'Ana Cruz', phone: '+639171234567', reason: 'Repair estimate', siteOrigin: 'https://shop.example', status: 'pending', consentedAt: time, createdAt: time, updatedAt: time },
      { id: '33333333-3333-4333-8333-333333333333', fullName: 'Ben Cruz', phone: '+639181234567', reason: 'Opening hours', siteOrigin: 'https://shop.example', status: 'pending', consentedAt: time, createdAt: time, updatedAt: time },
      { id: '66666666-6666-4666-8666-666666666666', fullName: 'Cora Cruz', phone: '+639191234567', reason: 'Bike service', siteOrigin: 'https://shop.example', status: 'pending', consentedAt: time, createdAt: time, updatedAt: time },
    ]
    const adminData = () => ({ settings, hasSavedBusiness: true, approvedDocuments: 2, hasOrganizationAi: true, usage: { sessions: 0, messages: 0, reservedTokens: 0, callbacks: 0 } })

    // Fail closed before feature-specific routes: a UI regression cannot contact a
    // provider, load a public widget, or write through an unrelated application API.
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      const blocked = /\/(?:api\/public\/website-receptionist|api\/(?:admin\/ai-provider|ai|voice|calling|knowledge))(?:\/|$)/.test(url.pathname)
        || /\/receptionist-widget(?:-frame)?\.js$/.test(url.pathname)
        || /(^|\.)(?:openai\.com|deepseek\.com|tokenrouter\.com|anthropic\.com|generativelanguage\.googleapis\.com|twilio\.com|groq\.com|openrouter\.ai|mistral\.ai)$/.test(url.hostname)
        || (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method()))
      if (blocked) { unexpected.push(`${request.method()} ${url.origin}${url.pathname}`); await route.fulfill({ status: 503, json: {} }); return }
      await route.continue()
    })
    await page.route('**/api/admin/receptionist**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (path === '/api/admin/receptionist' && request.method() === 'GET') { await route.fulfill({ json: phoneSettings }); return }
      unexpected.push(`${request.method()} ${path}`)
      await route.fulfill({ status: 503, json: {} })
    })
    await page.route('**/api/admin/website-receptionist**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname
      if (path === '/api/admin/website-receptionist') {
        if (request.method() === 'GET') { configReads++; await route.fulfill({ json: { data: adminData() } }); return }
        if (request.method() === 'PUT') {
          saves++
          const input = request.postDataJSON()
          expect(input).toEqual({ enabled: true, allowedOrigins: ['https://shop.example'], dailyMessageLimit: 7, dailyTokenLimit: 20000, dailyCallbackLimit: 10, expectedUpdatedAt: saves === 1 ? null : time, acknowledged: true })
          if (saves === 1) {
            settings = { publicId, enabled: false, allowedOrigins: ['https://shop.example'], dailyMessageLimit: 5, dailyTokenLimit: 20000, dailyCallbackLimit: 10, updatedAt: time }
            await route.fulfill({ status: 409, json: { error: { code: 'CONFLICT', message: 'Private SQL diagnostic must never reach the UI' } } }); return
          }
          settings = { publicId, enabled: true, allowedOrigins: input.allowedOrigins, dailyMessageLimit: input.dailyMessageLimit, dailyTokenLimit: input.dailyTokenLimit, dailyCallbackLimit: input.dailyCallbackLimit, updatedAt: nextTime }
          await route.fulfill({ json: { data: adminData() } }); return
        }
      }
      if (path === '/api/admin/website-receptionist/callbacks' && request.method() === 'GET') {
        callbackReads++
        const status = url.searchParams.get('status')
        expect(url.searchParams.get('page')).toBe('1')
        expect(['pending', 'all']).toContain(status)
        await route.fulfill({ json: { data: { callbacks: callbacks.filter(record => status === 'all' || record.status === status), page: 1, pageSize: 20, hasMore: false } } }); return
      }
      const record = callbacks.find(item => path === `/api/admin/website-receptionist/callbacks/${item.id}`)
      if (record && request.method() === 'PATCH') {
        const input = request.postDataJSON()
        expect(input.expectedUpdatedAt).toBe(time)
        expect(Object.keys(input).sort()).toEqual(['action', 'expectedUpdatedAt'])
        if (input.action === 'review') { reviews++; record.status = 'reviewed' }
        else { expect(input.action).toBe('dismiss'); dismissals++; record.status = 'dismissed' }
        record.updatedAt = nextTime
        await route.fulfill({ json: { data: record } }); return
      }
      if (record && request.method() === 'DELETE') {
        deletions++
        expect(record.fullName).toBe('Cora Cruz')
        callbacks = callbacks.filter(item => item.id !== record.id)
        await route.fulfill({ json: { data: { deleted: true } } }); return
      }
      unexpected.push(`${request.method()} ${path}`)
      await route.fulfill({ status: 503, json: {} })
    })

    await page.goto('/settings?section=receptionist')
    const website = page.getByRole('region', { name: 'Website receptionist', exact: true })
    const load = website.getByRole('button', { name: 'Load website receptionist settings', exact: true })
    await expect(load).toBeVisible()
    expect(configReads + saves + callbackReads + reviews + dismissals + deletions).toBe(0)
    await load.click()
    await expect(website.getByRole('checkbox', { name: 'Enable website receptionist', exact: true })).not.toBeChecked()
    await expect(website.getByRole('spinbutton', { name: 'Daily message limit', exact: true })).toHaveValue('5')
    await expect(website.getByRole('spinbutton', { name: 'Daily token allowance', exact: true })).toHaveValue('20000')
    await expect(website.getByRole('spinbutton', { name: 'Daily callback limit', exact: true })).toHaveValue('10')
    await expect(website.getByRole('textbox', { name: 'Website embed snippet', exact: true })).toHaveCount(0)
    await website.getByRole('checkbox', { name: 'Enable website receptionist', exact: true }).check()
    const save = website.getByRole('button', { name: 'Save website receptionist settings', exact: true })
    await expect(save).toBeDisabled()
    await website.getByRole('checkbox', { name: /I understand that website replies use/ }).check()
    await website.getByRole('spinbutton', { name: 'Daily message limit', exact: true }).fill('7')
    const origins = website.getByRole('textbox', { name: 'Allowed website origins', exact: true })
    for (const invalid of ['http://shop.example', 'https://shop.example/path', 'https://*.shop.example']) {
      await origins.fill(invalid)
      await save.click()
      await expect(website.getByRole('alert')).toContainText('exact HTTPS')
      expect(saves).toBe(0)
    }
    await origins.fill('https://SHOP.example/')
    await save.click()
    await expect(website.getByRole('alert')).toContainText('Your edits are preserved')
    await expect(origins).toHaveValue('https://SHOP.example/')
    await expect(website.getByRole('spinbutton', { name: 'Daily message limit', exact: true })).toHaveValue('7')
    await expect(website.getByRole('checkbox', { name: /I understand that website replies use/ })).toBeChecked()
    await expect(website.getByText('Private SQL diagnostic', { exact: false })).toHaveCount(0)
    await website.getByRole('button', { name: 'Reload website receptionist settings', exact: true }).click()
    await expect(website.getByText('Reloading replaces your unsaved website receptionist edits.', { exact: true })).toBeVisible()
    expect(configReads).toBe(1)
    await website.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(website.getByRole('spinbutton', { name: 'Daily message limit', exact: true })).toHaveValue('7')
    await website.getByRole('button', { name: 'Reload website receptionist settings', exact: true }).click()
    await website.getByRole('button', { name: 'Discard edits and reload', exact: true }).click()
    await expect(website.getByRole('spinbutton', { name: 'Daily message limit', exact: true })).toHaveValue('5')
    await website.getByRole('spinbutton', { name: 'Daily message limit', exact: true }).fill('7')
    await website.getByRole('checkbox', { name: 'Enable website receptionist', exact: true }).check()
    await website.getByRole('checkbox', { name: /I understand that website replies use/ }).check()
    await save.click()
    await expect(website.getByText('Website receptionist settings saved.', { exact: true })).toBeVisible()
    const snippet = website.getByRole('textbox', { name: 'Website embed snippet', exact: true })
    await expect(snippet).toHaveValue(`<script src="${new URL(page.url()).origin}/receptionist-widget.js" data-flowrish-receptionist="${publicId}" defer></script>`)
    await expect(website.locator('script, iframe')).toHaveCount(0)
    await expect(page.locator('script[src*="receptionist-widget"], iframe[src*="website-receptionist"]')).toHaveCount(0)
    expect(configReads).toBe(2)
    expect(saves).toBe(2)
    expect(callbackReads).toBe(0)

    await website.getByRole('button', { name: 'Load callback requests', exact: true }).click()
    const ana = website.getByRole('article', { name: 'Callback request from Ana Cruz', exact: true })
    await expect(ana.getByText('+639171234567', { exact: true })).toBeVisible()
    await expect(ana.getByText('Repair estimate', { exact: true })).toBeVisible()
    await expect(ana.getByText('https://shop.example', { exact: true })).toBeVisible()
    await expect(ana.getByText('Consent confirmed:', { exact: false })).toBeVisible()
    await expect(ana.locator('a[href^="tel:"]')).toHaveCount(0)
    await ana.getByRole('button', { name: 'Mark reviewed', exact: true }).click()
    await expect(website.getByText('Callback marked reviewed.', { exact: true })).toBeVisible()
    await expect(ana).toHaveCount(0)
    const ben = website.getByRole('article', { name: 'Callback request from Ben Cruz', exact: true })
    await ben.getByRole('button', { name: 'Dismiss callback', exact: true }).click()
    await expect(website.getByText('Callback dismissed.', { exact: true })).toBeVisible()
    await expect(ben).toHaveCount(0)
    const cora = website.getByRole('article', { name: 'Callback request from Cora Cruz', exact: true })
    await cora.getByRole('button', { name: 'Delete callback request', exact: true }).click()
    await expect(cora.getByText('Delete this callback request permanently?', { exact: false })).toBeVisible()
    expect(deletions).toBe(0)
    await cora.getByRole('button', { name: 'Cancel deletion', exact: true }).click()
    expect(deletions).toBe(0)
    await cora.getByRole('button', { name: 'Delete callback request', exact: true }).click()
    await cora.getByRole('button', { name: 'Confirm deletion', exact: true }).click()
    await expect(website.getByText('Callback request deleted.', { exact: true })).toBeVisible()
    await expect(website.getByText('No callback requests in this view.', { exact: true })).toBeVisible()
    await website.getByRole('combobox', { name: 'Callback status', exact: true }).selectOption('all')
    await website.getByRole('button', { name: 'Reload callback requests', exact: true }).click()
    await expect(website.getByRole('article', { name: 'Callback request from Ana Cruz', exact: true }).getByText('Reviewed', { exact: true })).toBeVisible()
    await expect(website.getByRole('article', { name: 'Callback request from Ben Cruz', exact: true }).getByText('Dismissed', { exact: true })).toBeVisible()
    expect(reviews).toBe(1)
    expect(dismissals).toBe(1)
    expect(deletions).toBe(1)
    expect(callbackReads).toBe(5)
    expect(unexpected).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await website.getByRole('article', { name: 'Callback request from Ana Cruz', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `/tmp/flowrish-website-admin-${mobile ? 'mobile' : 'desktop'}.png` })
  })
}
