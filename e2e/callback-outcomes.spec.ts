import { expect, test } from '@playwright/test'
const callbackId = '11111111-1111-4111-8111-111111111111', taskId = '22222222-2222-4222-8222-222222222222', owner = '33333333-3333-4333-8333-333333333333', nextOwner = '44444444-4444-4444-8444-444444444444'
const time = '2026-11-03T00:00:00.000Z'
for (const mobile of [false, true]) {
  test(`records, retries, reschedules and closes callback work on ${mobile ? 'mobile' : 'desktop'} with mocked writes`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    const unexpected: string[] = [], history: Array<Record<string, unknown>> = [], committed = new Map<string, unknown>()
    let sourceReads = 0, queueReads = 0, detailReads = 0, previews = 0, commits = 0, lostResponse = false, closed = false, version = 'a'.repeat(64)
    const task = { id: taskId, title: 'Callback: Synthetic Visitor', dueDate: '2020-01-01T00:00:00.000Z', assigneeId: owner, assigneeName: 'Original owner', isComplete: false }
    const source = { id: callbackId, fullName: 'Synthetic Visitor', phone: '+639171234567', reason: 'Repair request', status: 'pending', siteOrigin: 'https://shop.example', consentedAt: time, createdAt: time, updatedAt: time }
    const detail = () => ({ callbackId, taskId, version, source, closed, canEdit: !closed, leadAvailable: true, task, members: [{ id: owner, label: 'Original owner' }, { id: nextOwner, label: 'Next owner' }], membersTruncated: false, history: [...history].reverse(), hasMore: false, beforeNext: null })
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      const blocked = /(^|\.)(?:deepseek\.com|tokenrouter\.com|openai\.com|anthropic\.com|googleapis\.com|twilio\.com|openrouter\.ai)$/.test(url.hostname) || /\/api\/(?:ai|voice|calling|public\/website-receptionist|admin\/ai-provider)(?:\/|$)/.test(url.pathname) || (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method()))
      if (blocked) { unexpected.push(`${request.method()} ${url.pathname}`); await route.fulfill({ status: 503, json: {} }); return }
      await route.continue()
    })
    await page.route('**/api/admin/receptionist**', route => route.fulfill({ json: { config: { enabled: false, businessName: 'Synthetic Repairs', knowledge: '', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: owner, stageId: nextOwner }, businessName: 'Synthetic Workspace', currentUserId: owner, members: [{ id: owner, name: 'Original owner' }], stages: [{ id: nextOwner, name: 'New', pipeline: { name: 'Repairs' } }], calls: [], webhookPath: '/api/voice/receptionist/test' } }))
    await page.route('**/api/admin/website-receptionist/callbacks**', async route => {
      sourceReads++; const status = new URL(route.request().url()).searchParams.get('status'); await route.fulfill({ json: { data: { callbacks: status === 'all' || status === source.status ? [source] : [], page: 1, pageSize: 20, hasMore: false } } })
    })
    await page.route('**/api/callback-outcomes**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname
      if (path === '/api/callback-outcomes' && request.method() === 'GET') {
        queueReads++; const filter = url.searchParams.get('filter'); expect(url.searchParams.get('page')).toBe('1')
        const show = filter === 'all' || filter === 'closed' && closed || filter === 'open' && !closed || filter === 'overdue' && !closed && !task.isComplete && task.dueDate < time
        await route.fulfill({ json: { data: { rows: show ? [{ callbackId, taskId, title: task.title, assigneeName: task.assigneeName, dueDate: task.dueDate, isComplete: task.isComplete, closed, latestOutcome: history.at(-1)?.outcome ?? null }] : [], page: 1, hasMore: false } } }); return
      }
      if (path.endsWith(`/${callbackId}`) && request.method() === 'GET') { detailReads++; await route.fulfill({ json: { data: detail() } }); return }
      if (path.endsWith(`/${callbackId}/preview`)) {
        previews++; const body = request.postDataJSON(); expect(body.expectedVersion).toBe(version)
        await route.fulfill({ json: { data: { ...body, callbackId, version: 'e'.repeat(64), taskTitle: task.title, taskChange: body.draft.action === 'close' ? 'Complete the existing task.' : body.draft.action === 'reschedule' ? 'Update the existing owner and deadline.' : 'Keep task completion unchanged.', sourceChange: body.draft.action === 'close' ? 'Mark source reviewed and close request.' : 'Keep callback review status unchanged.', nextOwner: body.draft.assigneeId ? 'Next owner' : null, nextDueDate: body.draft.dueDate, reopensTask: body.draft.action === 'reschedule' && task.isComplete } } }); return
      }
      if (path.endsWith(`/${callbackId}`) && request.method() === 'POST') {
        commits++; const body = request.postDataJSON(); expect(body.confirmed).toBe(true); expect(body.previewVersion).toBe('e'.repeat(64))
        if (committed.has(body.requestId)) { expect(committed.get(body.requestId)).toEqual(body); await route.fulfill({ json: { data: { recorded: true, callbackId, requestId: body.requestId, action: body.draft.action } } }); return }
        expect(body.expectedVersion).toBe(version); committed.set(body.requestId, body)
        history.push({ id: body.requestId, sequence: history.length + 1, outcome: body.draft.outcome, action: body.draft.action, notes: body.draft.notes, createdAt: time, createdByName: 'Staff', assigneeName: body.draft.assigneeId ? 'Next owner' : null, dueDate: body.draft.dueDate })
        if (body.draft.action === 'reschedule') { task.assigneeId = nextOwner; task.assigneeName = 'Next owner'; task.dueDate = body.draft.dueDate; task.isComplete = false }
        if (body.draft.action === 'close') { task.isComplete = true; closed = true; source.status = 'reviewed' }
        version = ['b', 'd', 'f'][history.length - 1].repeat(64)
        if (!lostResponse) { lostResponse = true; await route.fulfill({ status: 503, json: { error: { message: 'Private SQL diagnostic' } } }); return }
        await route.fulfill({ json: { data: { recorded: true, callbackId, requestId: body.requestId, action: body.draft.action } } }); return
      }
      unexpected.push(`${request.method()} ${path}`); await route.fulfill({ status: 503, json: {} })
    })
    await page.goto('/settings?section=receptionist')
    const queue = page.getByRole('region', { name: 'Callback work queue', exact: true })
    expect(queueReads + detailReads + previews + commits).toBe(0)
    await page.getByRole('button', { name: 'Load callback requests', exact: true }).click(); await expect(page.getByRole('article', { name: 'Callback request from Synthetic Visitor', exact: true })).toBeVisible()
    await queue.getByRole('button', { name: 'Load callback work queue', exact: true }).click()
    let tracker = queue.getByRole('region', { name: 'Callback outcome tracking', exact: true })
    await tracker.getByRole('button', { name: 'Track callback outcome', exact: true }).click()
    await tracker.getByRole('combobox', { name: 'Callback result', exact: true }).selectOption('no_answer')
    await tracker.getByRole('textbox', { name: 'Outcome notes', exact: true }).fill('<img src=x onerror=alert(1)> No answer')
    await tracker.getByRole('button', { name: 'Preview outcome', exact: true }).click()
    await expect(tracker.getByRole('button', { name: 'Confirm callback outcome', exact: true })).toBeDisabled()
    await tracker.getByRole('checkbox', { name: /I approve recording/ }).check()
    await tracker.getByRole('textbox', { name: 'Outcome notes', exact: true }).fill('<img src=x onerror=alert(1)> Tried once')
    await expect(tracker.getByRole('button', { name: 'Confirm callback outcome', exact: true })).toHaveCount(0)
    await tracker.getByRole('button', { name: 'Preview outcome', exact: true }).click(); await tracker.getByRole('checkbox', { name: /I approve recording/ }).check(); await tracker.getByRole('button', { name: 'Confirm callback outcome', exact: true }).click()
    await expect(tracker.getByRole('alert')).toBeVisible(); expect(history).toHaveLength(1); expect(task.isComplete).toBe(false); expect(source.status).toBe('pending')
    await expect(page.getByText('Private SQL diagnostic', { exact: false })).toHaveCount(0)
    await tracker.getByRole('button', { name: 'Confirm callback outcome', exact: true }).click(); await expect(queue.getByRole('status').filter({ hasText: 'Callback outcome recorded.' }).first()).toBeVisible(); expect(history).toHaveLength(1)
    await expect(tracker.getByRole('button', { name: 'Reload outcome status', exact: true })).toBeEnabled(); await expect(tracker.locator('img')).toHaveCount(0)
    await queue.getByRole('combobox', { name: 'Callback work filter', exact: true }).selectOption('open'); await queue.getByRole('button', { name: 'Reload callback work queue', exact: true }).click(); await expect(queue.getByText('Showing open · Page 1', { exact: true })).toBeVisible()
    task.isComplete = true; version = 'c'.repeat(64)
    await tracker.getByRole('button', { name: 'Reload outcome status', exact: true }).click(); await expect(tracker.getByText('Task: Complete', { exact: true })).toBeVisible()
    await tracker.getByRole('combobox', { name: 'Callback result', exact: true }).selectOption('retry'); await tracker.getByRole('combobox', { name: 'Next action', exact: true }).selectOption('reschedule'); await tracker.getByRole('combobox', { name: 'Next callback owner', exact: true }).selectOption(nextOwner); await tracker.getByRole('textbox', { name: 'Next callback deadline', exact: true }).fill('2030-01-01T10:00')
    await tracker.getByRole('button', { name: 'Preview outcome', exact: true }).click(); await expect(tracker.getByText('This reopens the completed task.', { exact: true })).toBeVisible(); await tracker.getByRole('checkbox', { name: /I approve recording/ }).check(); await tracker.getByRole('button', { name: 'Confirm callback outcome', exact: true }).click()
    await expect(queue.getByRole('status').filter({ hasText: 'Callback rescheduled.' }).first()).toBeVisible(); expect(task.isComplete).toBe(false)
    await queue.getByRole('combobox', { name: 'Callback work filter', exact: true }).selectOption('overdue'); await queue.getByRole('button', { name: 'Reload callback work queue', exact: true }).click(); await expect(queue.getByText('No callback work in this view.', { exact: true })).toBeVisible()
    await queue.getByRole('combobox', { name: 'Callback work filter', exact: true }).selectOption('open'); await queue.getByRole('button', { name: 'Reload callback work queue', exact: true }).click(); tracker = queue.getByRole('region', { name: 'Callback outcome tracking', exact: true }); await tracker.getByRole('button', { name: 'Track callback outcome', exact: true }).click()
    await tracker.getByRole('combobox', { name: 'Callback result', exact: true }).selectOption('reached'); await tracker.getByRole('combobox', { name: 'Next action', exact: true }).selectOption('close'); await tracker.getByRole('button', { name: 'Preview outcome', exact: true }).click(); await tracker.getByRole('checkbox', { name: /I approve recording/ }).check(); await tracker.getByRole('button', { name: 'Confirm callback outcome', exact: true }).click()
    await expect(queue.getByRole('status').filter({ hasText: 'Callback closed and task completed.' }).first()).toBeVisible(); await expect(queue.getByText('No callback work in this view.', { exact: true })).toBeVisible(); expect(task.isComplete).toBe(true); expect(source.status).toBe('reviewed'); await expect(page.getByRole('article', { name: 'Callback request from Synthetic Visitor', exact: true })).toHaveCount(0); expect(sourceReads).toBe(2)
    await queue.getByRole('combobox', { name: 'Callback work filter', exact: true }).selectOption('closed'); await queue.getByRole('button', { name: 'Reload callback work queue', exact: true }).click(); tracker = queue.getByRole('region', { name: 'Callback outcome tracking', exact: true }); await tracker.getByRole('button', { name: 'Track callback outcome', exact: true }).click(); await expect(tracker.getByRole('combobox', { name: 'Callback result', exact: true })).toHaveCount(0)
    await expect(tracker.getByRole('region', { name: 'Callback outcome history', exact: true }).getByRole('article')).toHaveCount(3)
    expect(committed.size).toBe(3); expect(commits).toBe(4); expect(unexpected).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await tracker.scrollIntoViewIfNeeded(); await page.screenshot({ path: `/tmp/flowrish-outcomes-${mobile ? 'mobile' : 'desktop'}.png` })
  })
}
