import { expect, test } from '@playwright/test'
import type { HandoffDraft } from '../src/lib/callback-handoff'
import { homeFixture } from '../src/components/receptionist/home-fixture.test-data'

const callbackId = '11111111-1111-4111-8111-111111111111', leadId = '22222222-2222-4222-8222-222222222222', owner = '33333333-3333-4333-8333-333333333333', taskId = '44444444-4444-4444-8444-444444444444', secondId = '55555555-5555-4555-8555-555555555555'
const stamp = '2026-11-03T00:00:00.000Z'
for (const mobile of [false, true]) {
  test(`reviews dedicated callback inbox with mocked approvals on ${mobile ? 'mobile dark' : 'desktop light'}`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1080 }); await page.addInitScript(dark => localStorage.setItem('flowrish:theme', dark ? 'dark' : 'light'), mobile)
    const unexpected: string[] = []; let reads = 0, reviews = 0, deletes = 0, previews = 0, confirmations = 0, failList = false, removed = false
    let draft: HandoffDraft | null = null
    const callback = { id: callbackId, fullName: 'Sample Visitor', phone: '+639171234567', reason: '<img src=x onerror=alert(1)> Repair estimate', status: 'pending', siteOrigin: 'https://shop.example', consentedAt: stamp, createdAt: stamp, updatedAt: stamp }
    const receipt = { callbackId, leadId, taskId, createdAt: stamp, leadAvailable: true, taskAvailable: true }
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (/\/(?:api\/(?:ai|voice|calling|public\/website-receptionist|admin\/ai-provider|inngest))(?:\/|$)/.test(url.pathname) || /\/receptionist-widget(?:-frame)?\.js$/.test(url.pathname) || /(^|\.)(?:deepseek\.com|openai\.com|anthropic\.com|googleapis\.com|openrouter\.ai|tokenrouter\.com|twilio\.com)$/.test(url.hostname) || (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method()))) { unexpected.push(`${request.method()} ${url.pathname}`); await route.fulfill({ status: 503, json: {} }); return }
      await route.continue()
    })
    await page.route('**/api/receptionist/home', route => route.fulfill({ json: { data: homeFixture() } }))
    await page.route('**/api/admin/website-receptionist**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname
      if (path.endsWith('/callbacks') && request.method() === 'GET') {
        reads++; if (failList) { failList = false; await route.fulfill({ status: 403, json: { error: { message: 'PRIVATE provider diagnostic' } } }); return }
        const pageNumber = Number(url.searchParams.get('page')), status = url.searchParams.get('status'); expect(['pending', 'reviewed', 'dismissed', 'all']).toContain(status)
        const rows = removed || (status !== 'all' && status !== callback.status) ? [] : [pageNumber === 2 ? { ...callback, id: secondId, fullName: 'Second Visitor' } : callback]
        await route.fulfill({ json: { data: { callbacks: rows, page: pageNumber, pageSize: 20, hasMore: rows.length > 0 && pageNumber === 1 } } }); return
      }
      if (path.endsWith(`/${callbackId}/handoff/preview`) && request.method() === 'POST') {
        previews++; draft = request.postDataJSON(); expect(draft!.target).toEqual({ mode: 'lead', leadId }); expect(draft!.assigneeId).toBe(owner)
        await route.fulfill({ json: { data: { version: 'a'.repeat(64), draft, targetLabel: 'Sample Existing Lead', contactLabel: null, assigneeName: 'Callback Owner', taskTitle: 'Callback: Sample Visitor', taskDescription: callback.reason } } }); return
      }
      if (path.endsWith(`/${callbackId}/handoff`)) {
        if (request.method() === 'GET') { await route.fulfill({ json: { data: { callback, receipt: confirmations ? receipt : null, leads: [{ id: leadId, label: 'Sample Existing Lead' }], contacts: [], members: [{ id: owner, label: 'Callback Owner' }], stages: [], matchesTruncated: false, choicesTruncated: false } } }); return }
        expect(request.method()).toBe('POST'); expect(request.postDataJSON()).toEqual({ draft, previewVersion: 'a'.repeat(64), confirmed: true }); confirmations++; await route.fulfill({ json: { data: receipt } }); return
      }
      if (path.endsWith(`/${callbackId}`) && request.method() === 'PATCH') {
        expect(request.postDataJSON()).toEqual({ action: 'review', expectedUpdatedAt: stamp }); reviews++; callback.status = 'reviewed'; callback.updatedAt = '2026-11-03T00:01:00.000Z'; await route.fulfill({ json: { data: callback } }); return
      }
      if (path.endsWith(`/${callbackId}`) && request.method() === 'DELETE') { deletes++; removed = true; await route.fulfill({ json: { data: { deleted: true } } }); return }
      unexpected.push(`${request.method()} ${path}`); await route.fulfill({ status: 503, json: {} })
    })
    await page.goto('/receptionist'); await page.getByRole('link', { name: 'Review callback requests', exact: true }).click(); await expect(page).toHaveURL(/\/receptionist\/callbacks$/)
    await expect(page.getByRole('heading', { name: 'Receptionist callback inbox', exact: true })).toBeVisible(); await expect(page.getByText('Callback inbox', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Load website receptionist settings', exact: true })).toHaveCount(0); await expect(page.getByLabel('Enable website receptionist', { exact: true })).toHaveCount(0); expect(reads).toBe(0)
    await page.getByRole('button', { name: 'Load callback requests', exact: true }).click()
    const card = page.getByRole('article', { name: 'Callback request from Sample Visitor', exact: true }); await expect(card).toBeVisible(); await expect(card.locator('img')).toHaveCount(0)
    await page.getByRole('button', { name: 'Next callback page', exact: true }).click(); await expect(page.getByRole('article', { name: 'Callback request from Second Visitor', exact: true })).toBeVisible(); await expect(page.getByText(/Showing pending · Page 2/)).toBeVisible()
    await page.getByRole('button', { name: 'Previous callback page', exact: true }).click(); await expect(card).toBeVisible()
    for (const status of ['reviewed', 'dismissed', 'all']) { const before = reads; await page.getByRole('combobox', { name: 'Callback status', exact: true }).selectOption(status); expect(reads).toBe(before); await page.getByRole('button', { name: 'Reload callback requests', exact: true }).click(); await expect(page.getByText(new RegExp(`Showing ${status === 'all' ? 'all statuses' : status} · Page 1`))).toBeVisible(); if (status !== 'all') await expect(page.getByText('No callback requests in this view.', { exact: true })).toBeVisible() }
    await expect(card).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: `/tmp/flowrish-inbox-${mobile ? 'mobile-dark' : 'desktop-light'}.png` })
    await card.getByRole('button', { name: 'Prepare CRM handoff', exact: true }).click(); await card.getByRole('combobox', { name: 'CRM destination', exact: true }).selectOption(leadId); await card.getByRole('combobox', { name: 'Callback owner', exact: true }).selectOption(owner); await card.getByLabel('Callback deadline', { exact: true }).fill('2030-01-01T10:00'); await card.getByRole('button', { name: 'Preview callback task', exact: true }).click()
    await expect(card.getByRole('button', { name: 'Confirm CRM handoff', exact: true })).toBeDisabled(); expect(confirmations).toBe(0)
    await card.getByRole('checkbox', { name: /I approve creating this callback task/ }).check(); await card.getByLabel('Callback deadline', { exact: true }).fill('2030-01-02T10:00'); await expect(card.getByRole('button', { name: 'Confirm CRM handoff', exact: true })).toHaveCount(0)
    await card.getByRole('button', { name: 'Preview callback task', exact: true }).click(); await expect(card.getByRole('checkbox', { name: /I approve creating this callback task/ })).not.toBeChecked(); await card.getByRole('checkbox', { name: /I approve creating this callback task/ }).check(); await card.getByRole('button', { name: 'Confirm CRM handoff', exact: true }).click()
    await expect(card.getByRole('link', { name: 'Open lead', exact: true })).toHaveAttribute('href', `/leads/${leadId}`); await expect(card.getByRole('link', { name: 'Open callback task', exact: true })).toHaveAttribute('href', `/tasks/${taskId}`)
    await card.getByRole('button', { name: 'Mark reviewed', exact: true }).click(); await expect(page.getByText('Callback marked reviewed.', { exact: true })).toBeVisible(); await expect(card.getByText('Reviewed', { exact: true })).toBeVisible()
    failList = true; await page.getByRole('button', { name: 'Reload callback requests', exact: true }).click(); await expect(page.getByRole('main').getByRole('alert')).toContainText('Could not load callback requests'); await expect(card).toHaveCount(0); await expect(page.getByText(/PRIVATE provider diagnostic/)).toHaveCount(0)
    await page.getByRole('button', { name: 'Reload callback requests', exact: true }).click(); await expect(card).toBeVisible(); await card.getByRole('button', { name: 'Delete callback request', exact: true }).click(); expect(deletes).toBe(0); await card.getByRole('button', { name: 'Cancel deletion', exact: true }).click(); expect(deletes).toBe(0)
    await card.getByRole('button', { name: 'Delete callback request', exact: true }).click(); await card.getByRole('button', { name: 'Confirm deletion', exact: true }).click(); await expect(page.getByText('Callback request deleted.', { exact: true })).toBeVisible(); await expect(page.getByText('No callback requests in this view.', { exact: true })).toBeVisible()
    expect({ reviews, deletes, previews, confirmations }).toEqual({ reviews: 1, deletes: 1, previews: 2, confirmations: 1 }); expect(unexpected).toEqual([])
    await page.getByRole('link', { name: 'Receptionist home', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Sample Repairs', exact: true })).toBeVisible()
  })
}
