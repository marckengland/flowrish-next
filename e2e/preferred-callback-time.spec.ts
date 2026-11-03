import { expect, test } from '@playwright/test'
import { preferredTimeLabel, resolveCallbackTime } from '../src/lib/callback-time'

test.use({ timezoneId: 'America/Los_Angeles' })
const id = '11111111-1111-4111-8111-111111111111', leadId = '22222222-2222-4222-8222-222222222222', owner = '33333333-3333-4333-8333-333333333333', taskId = '44444444-4444-4444-8444-444444444444'
const calendar = { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], version: '2026-01-01T00:00:00.000Z' }
const day = new Date(Date.now() + 7 * 86400000); while (day.getUTCDay() !== 1) day.setUTCDate(day.getUTCDate() + 1)
const date = day.toISOString().slice(0, 10)
const timing = (hour: string) => resolveCallbackTime({ localTime: `${date}T${hour}:00`, timeZone: calendar.timeZone, businessVersion: calendar.version }, calendar)
const preferredTime = timing('10'), chosenTime = timing('11'), nextTime = timing('12')

for (const mobile of [false, true]) {
  test(`staff confirm and reschedule a preferred business time on ${mobile ? 'mobile' : 'desktop'} with all writes mocked`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    const unexpected: string[] = []
    let commits = 0, outcomeCommits = 0, version = 'c'.repeat(64), dueDate = chosenTime.at
    const history: object[] = []
    const callback = { id, fullName: 'Sample Visitor', phone: '+12025550123', reason: 'Discuss services', status: 'pending', siteOrigin: 'https://shop.example', consentedAt: calendar.version, createdAt: calendar.version, updatedAt: calendar.version, preferredTime }
    const receipt = { callbackId: id, leadId, taskId, createdAt: calendar.version, leadAvailable: true, taskAvailable: true, preferredTime }
    await page.route('**/*', async route => {
      const r = route.request(), url = new URL(r.url())
      if (/(^|\.)(deepseek\.com|openai\.com|anthropic\.com|googleapis\.com|openrouter\.ai|tokenrouter\.com|twilio\.com)$/.test(url.hostname) || /\/api\/(ai|voice|calling|public\/website-receptionist|admin\/ai-provider)(\/|$)/.test(url.pathname) || url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(r.method())) { unexpected.push(`${r.method()} ${url.pathname}`); await route.fulfill({ status: 503, json: {} }); return }
      await route.continue()
    })
    await page.route('**/api/admin/website-receptionist/callbacks**', async route => {
      const r = route.request(), path = new URL(r.url()).pathname
      if (path.endsWith('/callbacks') && r.method() === 'GET') { await route.fulfill({ json: { data: { callbacks: [callback], page: 1, pageSize: 20, hasMore: false } } }); return }
      if (path.endsWith('/handoff') && r.method() === 'GET') { await route.fulfill({ json: { data: { callback, receipt: null, leads: [{ id: leadId, label: 'Sample lead' }], contacts: [], members: [{ id: owner, label: 'Sample staff' }], stages: [], matchesTruncated: false, choicesTruncated: false, callbackHours: calendar } } }); return }
      if (path.endsWith('/handoff/preview') && r.method() === 'POST') {
        const draft = r.postDataJSON(); expect(draft.dueDate).toBe(chosenTime.at)
        await route.fulfill({ json: { data: { version: 'a'.repeat(64), draft, targetLabel: 'Sample lead', contactLabel: null, assigneeName: 'Sample staff', taskTitle: 'Callback: Sample Visitor', taskDescription: 'Approved sample task', preferredTime, confirmedTime: chosenTime } } }); return
      }
      if (path.endsWith('/handoff') && r.method() === 'POST') { commits++; expect(r.postDataJSON().confirmed).toBe(true); expect(r.postDataJSON().draft.dueDate).toBe(chosenTime.at); await route.fulfill({ json: { data: receipt } }); return }
      unexpected.push(`${r.method()} ${path}`); await route.fulfill({ status: 503, json: {} })
    })
    await page.route('**/api/callback-outcomes/**', async route => {
      const r = route.request(), path = new URL(r.url()).pathname
      if (r.method() === 'GET') { await route.fulfill({ json: { data: { callbackId: id, taskId, version, source: null, closed: false, canEdit: true, task: { id: taskId, title: 'Sample callback', dueDate, assigneeId: owner, assigneeName: 'Sample staff', isComplete: false }, leadAvailable: true, members: [{ id: owner, label: 'Sample staff' }], membersTruncated: false, history, hasMore: false, beforeNext: null, preferredTime, callbackHours: calendar } } }); return }
      const input = r.postDataJSON(); expect(input.draft.dueDate).toBe(nextTime.at)
      if (path.endsWith('/preview')) { await route.fulfill({ json: { data: { ...input, callbackId: id, version: 'e'.repeat(64), taskTitle: 'Sample callback', taskChange: 'Reschedule existing task', sourceChange: 'Retain removed source history', nextOwner: 'Sample staff', nextDueDate: nextTime.at, reopensTask: false, confirmedTime: nextTime } } }); return }
      outcomeCommits++; expect(input.confirmed).toBe(true); dueDate = nextTime.at; version = 'f'.repeat(64)
      history.push({ id: input.requestId, sequence: 1, outcome: 'retry', action: 'reschedule', notes: input.draft.notes, createdAt: new Date().toISOString(), createdByName: 'Sample staff', assigneeName: 'Sample staff', dueDate })
      await route.fulfill({ json: { data: { recorded: true, callbackId: id, requestId: input.requestId, action: 'reschedule' } } })
    })
    await page.goto('/receptionist/callbacks'); await page.getByRole('button', { name: 'Load callback requests', exact: true }).click()
    const handoff = page.getByRole('region', { name: 'CRM callback handoff', exact: true })
    await handoff.getByRole('button', { name: 'Prepare CRM handoff', exact: true }).click()
    await expect(handoff.getByText(`Requested callback time: ${preferredTimeLabel(preferredTime)}`, { exact: true })).toBeVisible()
    await handoff.getByRole('combobox', { name: 'CRM destination', exact: true }).selectOption(leadId); await handoff.getByRole('combobox', { name: 'Callback owner', exact: true }).selectOption(owner)
    const time = handoff.getByLabel('Confirmed callback time', { exact: true }); await expect(time).toHaveValue(preferredTime.localTime)
    await time.fill(chosenTime.localTime); await handoff.getByRole('button', { name: 'Preview callback task', exact: true }).click()
    await expect(handoff.getByText(`Staff-confirmed callback time: ${preferredTimeLabel(chosenTime)}`, { exact: true })).toBeVisible()
    await handoff.getByRole('checkbox', { name: /I approve creating this callback task/ }).check(); await time.fill(nextTime.localTime)
    await expect(handoff.getByRole('button', { name: 'Confirm CRM handoff', exact: true })).toHaveCount(0)
    await time.fill(chosenTime.localTime); await handoff.getByRole('button', { name: 'Preview callback task', exact: true }).click(); await handoff.getByRole('checkbox', { name: /I approve creating this callback task/ }).check(); await handoff.getByRole('button', { name: 'Confirm CRM handoff', exact: true }).click()
    const tracker = page.getByRole('region', { name: 'Callback outcome tracking', exact: true }); await tracker.getByRole('button', { name: 'Track callback outcome', exact: true }).click()
    await expect(tracker.getByText(`Requested callback time: ${preferredTimeLabel(preferredTime)}`, { exact: true })).toBeVisible()
    await tracker.getByRole('combobox', { name: 'Callback result', exact: true }).selectOption('retry'); await tracker.getByRole('combobox', { name: 'Next action', exact: true }).selectOption('reschedule'); await tracker.getByRole('combobox', { name: 'Next callback owner', exact: true }).selectOption(owner)
    await tracker.getByLabel('Next callback time', { exact: true }).fill(nextTime.localTime); await tracker.getByRole('button', { name: 'Preview outcome', exact: true }).click()
    await expect(tracker.getByText(`Staff-confirmed callback time: ${preferredTimeLabel(nextTime)}`, { exact: true })).toBeVisible()
    await expect(tracker.getByRole('button', { name: 'Confirm callback outcome', exact: true })).toBeDisabled(); await tracker.getByRole('checkbox', { name: /I approve recording this result/ }).check(); await tracker.getByRole('button', { name: 'Confirm callback outcome', exact: true }).click()
    await expect(tracker.getByRole('status').filter({ hasText: 'Callback rescheduled.' })).toBeVisible()
    expect(commits).toBe(1); expect(outcomeCommits).toBe(1); expect(unexpected).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await tracker.scrollIntoViewIfNeeded(); await page.screenshot({ path: `/tmp/flowrish-time-staff-${mobile ? 'mobile' : 'desktop'}.png` })
  })

  test(`demo practices requested and rescheduled times on ${mobile ? 'mobile' : 'desktop'} without API writes`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    const unexpected: string[] = []
    await page.route('**/*', async route => {
      const r = route.request(), url = new URL(r.url())
      if (/(^|\.)(deepseek\.com|openai\.com|anthropic\.com|googleapis\.com|openrouter\.ai|tokenrouter\.com|twilio\.com)$/.test(url.hostname) || /\/api\/(ai|voice|calling|public\/website-receptionist|admin\/ai-provider)(\/|$)/.test(url.pathname) || url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(r.method())) { unexpected.push(`${r.method()} ${url.pathname}`); await route.fulfill({ status: 503, json: {} }); return }
      await route.continue()
    })
    await page.goto('/receptionist/demo'); await page.getByRole('button', { name: 'Practice a callback', exact: true }).click()
    await page.getByLabel('Sample preferred callback time', { exact: true }).fill(preferredTime.localTime); await page.getByRole('button', { name: 'Review simulated callback', exact: true }).click(); await page.getByRole('checkbox', { name: 'I confirm these fictional callback details.', exact: true }).check(); await page.getByRole('button', { name: 'Confirm simulated callback', exact: true }).click()
    await page.getByLabel('Simulated confirmed callback time', { exact: true }).fill(chosenTime.localTime); await page.getByRole('button', { name: 'Preview simulated CRM handoff', exact: true }).click(); await page.getByRole('checkbox', { name: 'I approve this simulated lead and task.', exact: true }).check(); await page.getByRole('button', { name: 'Create simulated CRM handoff', exact: true }).click()
    const receipt = page.getByRole('region', { name: 'Simulated CRM receipt', exact: true }); await expect(receipt).toContainText(preferredTimeLabel(chosenTime))
    await page.getByRole('combobox', { name: 'Simulated callback outcome', exact: true }).selectOption('retry'); await page.getByLabel('Simulated next callback time', { exact: true }).fill(nextTime.localTime); await page.getByRole('button', { name: 'Preview simulated outcome', exact: true }).click(); await page.getByRole('checkbox', { name: 'I confirm this simulated outcome.', exact: true }).check(); await page.getByRole('button', { name: 'Record simulated outcome', exact: true }).click()
    await expect(receipt).toContainText(preferredTimeLabel(nextTime)); await expect(page.getByText(`Requested callback time: ${preferredTimeLabel(preferredTime)}`, { exact: true })).toBeVisible()
    expect(unexpected).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await receipt.scrollIntoViewIfNeeded(); await page.screenshot({ path: `/tmp/flowrish-time-demo-${mobile ? 'mobile' : 'desktop'}.png` })
  })
}
