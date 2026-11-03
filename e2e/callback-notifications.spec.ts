import { expect, test } from '@playwright/test'
const time = '2026-11-03T00:00:00.000Z', callbackId = '11111111-1111-4111-8111-111111111111', taskId = '22222222-2222-4222-8222-222222222222'
for (const mobile of [false, true]) {
  test(`reads callback alerts with mocked writes on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    const unexpected: string[] = [], commits: unknown[] = []; let lostResponse = false, listReads = 0, counts = 0
    const rows = Array.from({ length: 22 }, (_, index) => ({ key: index.toString(16).padStart(64, '0'), kind: index === 1 ? 'new_callback' : index === 2 ? 'assigned' : 'overdue', callbackId, taskId: index === 1 ? null : taskId, dueDate: index === 1 ? null : time, createdAt: time, readAt: null as string | null }))
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      const blocked = /(^|\.)(?:deepseek\.com|openai\.com|anthropic\.com|googleapis\.com|tokenrouter\.com|openrouter\.ai|twilio\.com)$/.test(url.hostname) || /\/api\/(?:ai|voice|calling|public\/website-receptionist|admin\/ai-provider|inngest)(?:\/|$)/.test(url.pathname) || (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method()))
      if (blocked) { unexpected.push(`${request.method()} ${url.pathname}`); await route.fulfill({ status: 503, json: {} }); return }
      await route.continue()
    })
    await page.route('**/api/callback-notifications**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname
      if (path.endsWith('/count') && request.method() === 'GET') { counts++; await route.fulfill({ json: { data: { unread: rows.filter(row => row.readAt === null).length } } }); return }
      if (path === '/api/callback-notifications' && request.method() === 'GET') {
        listReads++; const pageNumber = Number(url.searchParams.get('page')), filter = url.searchParams.get('filter'); expect(['unread', 'all']).toContain(filter); const eligible = rows.filter(row => filter === 'all' || row.readAt === null); await route.fulfill({ json: { data: { rows: eligible.slice((pageNumber - 1) * 20, pageNumber * 20), page: pageNumber, hasMore: eligible.length > pageNumber * 20 } } }); return
      }
      const row = rows.find(row => path === `/api/callback-notifications/${row.key}`)
      if (row && request.method() === 'PATCH') { const body = request.postDataJSON(); expect(body).toEqual({ read: true }); commits.push(body); row.readAt ??= time
        if (!lostResponse) { lostResponse = true; await route.fulfill({ status: 503, json: { error: { message: '<img src=x> private SQL diagnostic' } } }); return }
        await route.fulfill({ json: { data: { key: row.key, readAt: row.readAt } } }); return
      }
      unexpected.push(`${request.method()} ${path}`); await route.fulfill({ status: 503, json: {} })
    })
    await page.goto('/dashboard'); const bell = page.getByRole('link', { name: 'Notifications, 22 unread', exact: true }); await expect(bell).toBeVisible(); expect(listReads).toBe(0); expect(commits).toHaveLength(0); await bell.click()
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible(); await expect(page.getByRole('article')).toHaveCount(20); await expect(page.getByText('Showing unread · Page 1', { exact: true })).toBeVisible(); expect(commits).toHaveLength(0)
    await expect(page.getByRole('link', { name: 'Review callback requests', exact: true })).toHaveAttribute('href', '/settings?section=receptionist'); await expect(page.getByRole('link', { name: 'Open callback task', exact: true }).first()).toHaveAttribute('href', `/tasks/${taskId}`)
    const first = page.getByRole('article').first(); await first.getByRole('button', { name: 'Mark read', exact: true }).click(); await expect(page.getByRole('main').getByRole('alert')).toContainText('Refresh or retry'); await expect(page.getByText('private SQL diagnostic', { exact: false })).toHaveCount(0); await expect(page.locator('main img')).toHaveCount(0); await expect(first.getByRole('button', { name: 'Mark read', exact: true })).toBeEnabled(); await first.getByRole('button', { name: 'Mark read', exact: true }).click()
    await expect(page.getByText('Notification marked read.', { exact: true })).toBeVisible(); await expect(page.getByRole('link', { name: 'Notifications, 21 unread', exact: true })).toBeVisible(); expect(commits).toHaveLength(2); expect(rows.filter(row => row.readAt !== null)).toHaveLength(1)
    await page.getByRole('button', { name: 'Next page', exact: true }).click(); await expect(page.getByText('Showing unread · Page 2', { exact: true })).toBeVisible(); await expect(page.getByRole('article')).toHaveCount(1)
    await page.getByRole('combobox', { name: 'Notification filter', exact: true }).selectOption('all'); await expect(page.getByText('Showing all · Page 1', { exact: true })).toBeVisible(); await expect(page.getByRole('article').first().getByText('Read', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Refresh notifications', exact: true }).click(); await expect(page.getByRole('article')).toHaveCount(20); expect(commits).toHaveLength(2); expect(counts).toBeGreaterThanOrEqual(2); expect(unexpected).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `/tmp/flowrish-alerts-${mobile ? 'mobile' : 'desktop'}.png` })
  })
}
