import { expect, test } from '@playwright/test'
import type { HandoffDraft } from '../src/lib/callback-handoff'

const callbackId = '11111111-1111-4111-8111-111111111111', leadId = '22222222-2222-4222-8222-222222222222', owner = '33333333-3333-4333-8333-333333333333', stageId = '44444444-4444-4444-8444-444444444444', contactId = '55555555-5555-4555-8555-555555555555', taskId = '66666666-6666-4666-8666-666666666666'
const time = '2026-11-03T00:00:00.000Z'
for (const mobile of [false, true]) for (const createLead of [false, true]) {
  test(`approves ${createLead ? 'new linked lead' : 'existing lead'} callback handoff on ${mobile ? 'mobile' : 'desktop'} without providers`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    const unexpected: string[] = []
    let reads = 0, previews = 0, confirmations = 0, taskCreates = 0
    let reviewed: HandoffDraft | null = null
    const callback = { id: callbackId, fullName: 'Jamie Example', phone: '+639171234567', reason: '<img src=x onerror=alert(1)> repair estimate', status: 'pending', siteOrigin: 'https://shop.example', consentedAt: time, createdAt: time, updatedAt: time }
    const receipt = { callbackId, leadId, taskId, createdAt: time, leadAvailable: true, taskAvailable: true }
    const options = { callback, receipt: null as typeof receipt | null, leads: [{ id: leadId, label: 'Jamie Existing · +639171234567' }], contacts: [{ id: contactId, label: 'Jamie Contact', leadIds: [leadId] }], members: [{ id: owner, label: 'Callback Owner' }], stages: [{ id: stageId, label: 'Repairs / New' }], matchesTruncated: false, choicesTruncated: false }
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      const blocked = /(^|\.)(?:deepseek\.com|tokenrouter\.com|openai\.com|anthropic\.com|googleapis\.com|twilio\.com|openrouter\.ai)$/.test(url.hostname)
        || /\/api\/(?:ai|voice|calling|public\/website-receptionist|admin\/ai-provider)(?:\/|$)/.test(url.pathname)
        || (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method()))
      if (blocked) { unexpected.push(`${request.method()} ${url.pathname}`); await route.fulfill({ status: 503, json: {} }); return }
      await route.continue()
    })
    await page.route('**/api/admin/receptionist**', route => route.fulfill({ json: { config: { enabled: false, businessName: 'Synthetic Repairs', knowledge: '', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: owner, stageId }, businessName: 'Synthetic Workspace', currentUserId: owner, members: [{ id: owner, name: 'Callback Owner' }], stages: [{ id: stageId, name: 'New', pipeline: { name: 'Repairs' } }], calls: [], webhookPath: '/api/voice/receptionist/test' } }))
    await page.route('**/api/admin/website-receptionist**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (path.endsWith('/callbacks') && request.method() === 'GET') { await route.fulfill({ json: { data: { callbacks: [callback], page: 1, pageSize: 20, hasMore: false } } }); return }
      if (path.endsWith(`/${callbackId}/handoff/preview`)) {
        previews++; reviewed = request.postDataJSON(); expect(request.method()).toBe('POST'); expect(reviewed!.assigneeId).toBe(owner); expect(reviewed!.expectedUpdatedAt).toBe(time)
        if (createLead) expect(reviewed!.target).toEqual({ mode: 'new', firstName: 'Jamie', lastName: 'Example', stageId, contactId })
        else expect(reviewed!.target).toEqual({ mode: 'lead', leadId })
        await route.fulfill({ json: { data: { version: 'a'.repeat(64), draft: reviewed, targetLabel: createLead ? 'New lead: Jamie Example' : 'Jamie Existing', contactLabel: createLead ? 'Jamie Contact' : null, assigneeName: 'Callback Owner', taskTitle: 'Callback: Jamie Example', taskDescription: `${callback.reason}\nSource: /settings?section=receptionist&callback=${callbackId}` } } }); return
      }
      if (path.endsWith(`/${callbackId}/handoff`)) {
        if (request.method() === 'GET') { reads++; await route.fulfill({ json: { data: options } }); return }
        confirmations++; expect(request.postDataJSON()).toEqual({ draft: reviewed, previewVersion: 'a'.repeat(64), confirmed: true })
        if (confirmations === 1) { taskCreates++; await route.fulfill({ status: 503, json: { error: { message: 'Private SQL diagnostic' } } }); return }
        await route.fulfill({ json: { data: receipt } }); return
      }
      unexpected.push(`${request.method()} ${path}`); await route.fulfill({ status: 503, json: {} })
    })
    await page.goto('/settings?section=receptionist')
    await page.getByRole('button', { name: 'Load callback requests', exact: true }).click()
    const card = page.getByRole('article', { name: 'Callback request from Jamie Example', exact: true })
    expect(reads + previews + confirmations).toBe(0)
    await card.getByRole('button', { name: 'Prepare CRM handoff', exact: true }).click()
    await expect(card.getByRole('combobox', { name: 'CRM destination', exact: true })).toBeVisible(); expect(reads).toBe(1)
    await expect(card.locator('img')).toHaveCount(0)
    await card.getByRole('combobox', { name: 'CRM destination', exact: true }).selectOption(createLead ? 'new' : leadId)
    if (createLead) { await card.getByRole('combobox', { name: 'New lead stage', exact: true }).selectOption(stageId); await card.getByRole('combobox', { name: 'Link matching contact', exact: true }).selectOption(contactId); await card.getByRole('checkbox', { name: 'I reviewed existing matches and approve creating another lead.', exact: true }).check() }
    await card.getByRole('combobox', { name: 'Callback owner', exact: true }).selectOption(owner)
    await card.getByLabel('Callback deadline', { exact: true }).fill('2030-01-01T10:00')
    await card.getByRole('button', { name: 'Preview callback task', exact: true }).click()
    await expect(card.getByRole('button', { name: 'Confirm CRM handoff', exact: true })).toBeDisabled()
    expect(taskCreates).toBe(0)
    await card.getByRole('checkbox', { name: /I approve creating this callback task/ }).check()
    await card.getByLabel('Callback deadline', { exact: true }).fill('2030-01-02T10:00')
    await expect(card.getByRole('button', { name: 'Confirm CRM handoff', exact: true })).toHaveCount(0)
    await card.getByRole('button', { name: 'Preview callback task', exact: true }).click()
    await expect(card.getByRole('checkbox', { name: /I approve creating this callback task/ })).not.toBeChecked()
    await card.getByRole('checkbox', { name: /I approve creating this callback task/ }).check()
    await card.getByRole('button', { name: 'Confirm CRM handoff', exact: true }).click()
    await expect(card.getByRole('alert')).toContainText('Could not confirm the handoff')
    await expect(page.getByText('Private SQL diagnostic', { exact: false })).toHaveCount(0)
    await card.getByRole('button', { name: 'Confirm CRM handoff', exact: true }).click()
    await expect(card.getByRole('link', { name: 'Open callback task', exact: true })).toHaveAttribute('href', `/tasks/${taskId}`)
    await expect(card.getByRole('link', { name: 'Open lead', exact: true })).toHaveAttribute('href', `/leads/${leadId}`)
    await expect(card.getByRole('button', { name: 'Preview callback task', exact: true })).toHaveCount(0)
    expect(taskCreates).toBe(1); expect(confirmations).toBe(2); expect(previews).toBe(2); expect(unexpected).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (createLead) { await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: `/tmp/flowrish-handoff-${mobile ? 'mobile' : 'desktop'}.png` }) }
    options.receipt = receipt
    await page.goto(`/settings?section=receptionist&callback=${callbackId}`)
    const source = page.getByText('Source callback handoff', { exact: true }).locator('..')
    await source.getByRole('button', { name: 'Prepare CRM handoff', exact: true }).click()
    await expect(source.getByText('This callback has already been handed to CRM.', { exact: true })).toBeVisible()
    await expect(source.getByRole('link', { name: 'Open callback task', exact: true })).toHaveAttribute('href', `/tasks/${taskId}`)
    await expect(source.getByRole('button', { name: 'Preview callback task', exact: true })).toHaveCount(0)
    expect(taskCreates).toBe(1); expect(unexpected).toEqual([])
  })
}
