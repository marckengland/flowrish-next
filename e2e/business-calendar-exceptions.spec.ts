import { expect, test } from '@playwright/test'
import { setupFixture } from '../src/components/settings/receptionist-setup-fixture.test-data'
import { responseFixture, responseManager } from '../src/components/callbacks/response-fixture.test-data'
import { resolveCallbackTime } from '../src/lib/callback-time'

test.use({ timezoneId: 'America/Los_Angeles' })
const id = responseManager, leadId = '22222222-2222-4222-8222-222222222222', taskId = '33333333-3333-4333-8333-333333333333'
const day = new Date(Date.now() + 7 * 86400000); while (day.getUTCDay() !== 1) day.setUTCDate(day.getUTCDate() + 1)
const date = day.toISOString().slice(0, 10), next = new Date(day.getTime() + 86400000).toISOString().slice(0, 10), after = new Date(day.getTime() + 2 * 86400000).toISOString().slice(0, 10)
const weekly = { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], version: '2026-01-01T00:00:00.000Z' }
const preferredTime = resolveCallbackTime({ localTime: `${date}T10:00`, timeZone: weekly.timeZone, businessVersion: weekly.version }, weekly)
const chosen = resolveCallbackTime({ localTime: `${next}T11:00`, timeZone: weekly.timeZone, businessVersion: weekly.version }, weekly), rescheduled = resolveCallbackTime({ localTime: `${after}T11:00`, timeZone: weekly.timeZone, businessVersion: weekly.version }, weekly)

for (const mobile of [false, true]) test(`administrators manage date overrides and staff review affected callbacks on ${mobile ? 'mobile' : 'desktop'} with writes mocked`, async ({ page }) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 })
  const unexpected: string[] = [], snapshot = setupFixture(), policy = responseFixture()
  const calendarExceptions = [{ date, closed: true as const }, { date: next, closed: false as const, opensAt: '11:00', closesAt: '14:00' }]
  let businessWrites = 0, policyWrites = 0, handoffs = 0, outcomes = 0, taskDate = chosen.at
  const callback = { id, fullName: 'Sample Visitor', phone: '+12025550123', reason: 'Discuss services', status: 'pending', siteOrigin: 'https://shop.example', consentedAt: weekly.version, createdAt: weekly.version, updatedAt: weekly.version, preferredTime, calendarReviewRequired: true }
  const receipt = { callbackId: id, leadId, taskId, createdAt: weekly.version, leadAvailable: true, taskAvailable: true, preferredTime }
  await page.route('**/*', async route => {
    const r = route.request(), url = new URL(r.url())
    if (/(^|\.)(deepseek\.com|openai\.com|anthropic\.com|googleapis\.com|openrouter\.ai|tokenrouter\.com|twilio\.com)$/.test(url.hostname) || /\/api\/(ai|voice|calling|public\/website-receptionist|admin\/ai-provider)(\/|$)/.test(url.pathname) || url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(r.method())) { unexpected.push(`${r.method()} ${url.pathname}`); await route.fulfill({ status: 503, json: {} }); return }
    await route.continue()
  })
  await page.route('**/api/admin/receptionist/setup**', async route => {
    const r = route.request(), path = new URL(r.url()).pathname
    if (r.method() === 'GET' && path.endsWith('/setup')) return route.fulfill({ json: { data: snapshot } })
    if (r.method() !== 'PATCH' || !path.endsWith('/business')) throw Error('Unexpected setup write')
    const input = r.postDataJSON(); expect(input.values.calendarExceptions).toEqual(calendarExceptions); expect(input.expectedUpdatedAt).toBe(snapshot.business.updatedAt); expect(input.values).not.toHaveProperty('enabled')
    businessWrites++; snapshot.business.values = input.values; snapshot.business.updatedAt = '2026-11-04T00:00:00.000Z'; snapshot.version = 'b'.repeat(64)
    return route.fulfill({ json: { data: snapshot } })
  })
  policy.policy = { ...policy.policy, enabled: true, backupUserId: id, hours: policy.business.hours, updatedAt: policy.business.updatedAt, businessUpdatedAt: policy.business.updatedAt }; policy.business.hours = { ...policy.business.hours!, calendarExceptions }; policy.hoursChanged = true; policy.managerAvailable = true
  await page.route('**/api/admin/callback-response-policy', async route => {
    const r = route.request()
    if (r.method() === 'PUT') { expect(r.postDataJSON().acknowledged).toBe(true); policyWrites++; policy.policy.hours = policy.business.hours; policy.hoursChanged = false }
    else expect(r.method()).toBe('GET')
    return route.fulfill({ json: { data: policy } })
  })
  await page.route('**/api/admin/website-receptionist/callbacks**', async route => {
    const r = route.request(), path = new URL(r.url()).pathname
    if (path.endsWith('/callbacks') && r.method() === 'GET') return route.fulfill({ json: { data: { callbacks: [callback], page: 1, pageSize: 20, hasMore: false } } })
    if (path.endsWith('/handoff') && r.method() === 'GET') return route.fulfill({ json: { data: { callback, receipt: null, leads: [{ id: leadId, label: 'Sample lead' }], contacts: [], members: [{ id, label: 'Sample staff' }], stages: [], matchesTruncated: false, choicesTruncated: false, callbackHours: { ...weekly, calendarExceptions } } } })
    if (path.endsWith('/handoff/preview') && r.method() === 'POST') { const draft = r.postDataJSON(); expect(draft.dueDate).toBe(chosen.at); return route.fulfill({ json: { data: { version: 'c'.repeat(64), draft, targetLabel: 'Sample lead', contactLabel: null, assigneeName: 'Sample staff', taskTitle: 'Callback: Sample Visitor', taskDescription: 'Staff approved sample task', preferredTime, confirmedTime: chosen } } }) }
    if (path.endsWith('/handoff') && r.method() === 'POST') { expect(r.postDataJSON().confirmed).toBe(true); expect(r.postDataJSON().draft.dueDate).toBe(chosen.at); handoffs++; return route.fulfill({ json: { data: receipt } }) }
    throw Error('Unexpected callback write')
  })
  await page.route('**/api/callback-outcomes/**', async route => {
    const r = route.request(), path = new URL(r.url()).pathname, hours = { ...weekly, calendarExceptions: [{ date, closed: true }, { date: next, closed: true }] }
    if (r.method() === 'GET') return route.fulfill({ json: { data: { callbackId: id, taskId, version: 'd'.repeat(64), source: null, closed: false, canEdit: true, task: { id: taskId, title: 'Sample callback', dueDate: taskDate, assigneeId: id, assigneeName: 'Sample staff', isComplete: false }, leadAvailable: true, members: [{ id, label: 'Sample staff' }], membersTruncated: false, history: [], hasMore: false, beforeNext: null, preferredTime, callbackHours: hours, ...(taskDate === chosen.at ? { calendarReviewRequired: true } : {}) } } })
    const input = r.postDataJSON(); expect(input.draft.dueDate).toBe(rescheduled.at)
    if (path.endsWith('/preview')) return route.fulfill({ json: { data: { ...input, callbackId: id, version: 'e'.repeat(64), taskTitle: 'Sample callback', taskChange: 'Reschedule existing task', sourceChange: 'Retain removed source history', nextOwner: 'Sample staff', nextDueDate: rescheduled.at, reopensTask: false, confirmedTime: rescheduled } } })
    expect(input.confirmed).toBe(true); outcomes++; taskDate = rescheduled.at
    return route.fulfill({ json: { data: { recorded: true, callbackId: id, requestId: input.requestId, action: 'reschedule' } } })
  })
  await page.goto('/receptionist/setup'); await page.getByRole('button', { name: '1. Business', exact: true }).click()
  await page.getByLabel('Exception date', { exact: true }).fill(date); await page.getByRole('button', { name: 'Add date override', exact: true }).click()
  await page.getByLabel('Exception date', { exact: true }).fill(next); await page.getByRole('combobox', { name: 'Date availability', exact: true }).selectOption('hours'); await page.getByLabel('Date opening time', { exact: true }).fill('11:00'); await page.getByLabel('Date closing time', { exact: true }).fill('14:00'); await page.getByRole('button', { name: 'Add date override', exact: true }).click()
  expect(businessWrites).toBe(0); await page.getByRole('button', { name: '2. Library', exact: true }).click(); await expect(page.getByRole('alertdialog', { name: 'Unsaved setup edits', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await page.getByRole('button', { name: 'Save business details', exact: true }).click(); await expect(page.getByText('Business details saved.', { exact: true })).toBeVisible(); expect(snapshot.website.settings?.enabled).toBe(false)
  await page.getByRole('group', { name: 'Holiday closures and special hours', exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: `/tmp/flowrish-calendar-settings-${mobile ? 'mobile' : 'desktop'}.png` })
  await page.goto('/callbacks/response-targets'); const editor = page.getByRole('region', { name: 'Callback response policy', exact: true })
  await expect(editor.getByText(`${date}: Closed`, { exact: true })).toBeVisible(); await expect(editor.getByRole('button', { name: 'Save response targets', exact: true })).toBeDisabled(); await editor.getByRole('checkbox', { name: /I approve applying these targets/ }).check(); await editor.getByRole('button', { name: 'Save response targets', exact: true }).click(); await expect(editor.getByRole('status').filter({ hasText: 'Response targets saved.' })).toBeVisible()
  await page.goto('/receptionist/callbacks'); await page.getByRole('button', { name: 'Load callback requests', exact: true }).click(); await expect(page.getByRole('status', { name: 'Callback calendar review', exact: true })).toBeVisible()
  const handoff = page.getByRole('region', { name: 'CRM callback handoff', exact: true }); await handoff.getByRole('button', { name: 'Prepare CRM handoff', exact: true }).click(); await expect(handoff.getByRole('status', { name: 'Callback calendar review', exact: true })).toBeVisible(); await expect(handoff.getByLabel('Confirmed callback time', { exact: true })).toHaveValue('')
  await handoff.getByRole('combobox', { name: 'CRM destination', exact: true }).selectOption(leadId); await handoff.getByRole('combobox', { name: 'Callback owner', exact: true }).selectOption(id); await handoff.getByLabel('Confirmed callback time', { exact: true }).fill(chosen.localTime); await handoff.getByRole('button', { name: 'Preview callback task', exact: true }).click(); await expect(handoff.getByRole('button', { name: 'Confirm CRM handoff', exact: true })).toBeDisabled(); await handoff.getByRole('checkbox', { name: /I approve creating this callback task/ }).check(); await handoff.getByRole('button', { name: 'Confirm CRM handoff', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Callback calendar review', exact: true })).toHaveCount(0)
  const tracker = page.getByRole('region', { name: 'Callback outcome tracking', exact: true }); await tracker.getByRole('button', { name: 'Track callback outcome', exact: true }).click(); await expect(tracker.getByRole('status', { name: 'Callback calendar review', exact: true })).toBeVisible()
  await tracker.getByRole('combobox', { name: 'Callback result', exact: true }).selectOption('retry'); await tracker.getByRole('combobox', { name: 'Next action', exact: true }).selectOption('reschedule'); await tracker.getByRole('combobox', { name: 'Next callback owner', exact: true }).selectOption(id); await tracker.getByLabel('Next callback time', { exact: true }).fill(rescheduled.localTime); await tracker.getByRole('button', { name: 'Preview outcome', exact: true }).click(); await tracker.getByRole('checkbox', { name: /I approve recording this result/ }).check(); await tracker.getByRole('button', { name: 'Confirm callback outcome', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Callback calendar review', exact: true })).toHaveCount(0); await expect(tracker.getByRole('status').filter({ hasText: 'Callback rescheduled.' })).toBeVisible()
  expect(businessWrites).toBe(1); expect(policyWrites).toBe(1); expect(handoffs).toBe(1); expect(outcomes).toBe(1); expect(unexpected).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await tracker.scrollIntoViewIfNeeded(); await page.screenshot({ path: `/tmp/flowrish-calendar-workflow-${mobile ? 'mobile' : 'desktop'}.png` })
})
