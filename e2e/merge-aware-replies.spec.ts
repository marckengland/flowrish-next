import { expect, test, type Page } from '@playwright/test'
import { coreIds } from './rehearsal-app/core-fixtures'
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' })
const id = '11111111-1111-4111-8111-111111111111'
const item = { id, fromEmail: 'archive@example.invalid', subject: 'Synthetic archived-address reply', bodyPreview: 'Please call about the proposal.', sentAt: '2026-11-05T00:00:00.000Z', mailboxEmail: 'owner@example.invalid', reason: 'AMBIGUOUS' }
function store() { return { calls: [] as Array<{ path: string; body: Record<string, unknown> }>, unexpected: [] as string[], applied: 0, lost: false, stale: false, denied: false, accountChanged: false, receipt: null as Record<string, unknown> | null } }
async function mock(page: Page, baseURL: string, state: ReturnType<typeof store>) {
  const origin = new URL(baseURL).origin
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method()
    const reply = (data: unknown) => route.fulfill({ json: { data, scope: { organizationId: coreIds.organization, userId: coreIds.user }, capabilities: { canWrite: new URL(page.url()).searchParams.get('readonly') !== 'true' } } })
    const error = (status: number, code: string, message: string) => route.fulfill({ status, json: { error: { code, message } } })
    if (url.origin !== origin || /receptionist-widget/.test(path)) { state.unexpected.push(`${method} ${path}`); await route.abort(); return }
    if (path.startsWith('/api/email/matches')) {
      if (req.headers()['x-flowrish-workspace'] !== coreIds.organization || req.headers()['x-flowrish-mail-match-user'] !== coreIds.user) { state.unexpected.push('Missing match identity'); await route.abort(); return }
      if (state.accountChanged) { await error(409, 'EMAIL_MATCH_CONTEXT_CHANGED', 'Account changed'); return }
      if (state.denied) { await error(403, 'FORBIDDEN', 'Access revoked'); return }
      if (method === 'GET' && path === '/api/email/matches') { await reply(state.receipt ? [] : [item]); return }
      if (method !== 'POST' || ![ `/api/email/matches/${id}/preview`, `/api/email/matches/${id}/resolve` ].includes(path)) { state.unexpected.push(`${method} ${path}`); await route.abort(); return }
      const body = req.postDataJSON(); state.calls.push({ path, body })
      if (path.endsWith('/preview')) { expect(body).toEqual({}); await reply({ message: item, version: 'a'.repeat(64), candidates: [{ id: coreIds.lead, label: 'Retained Practice', email: 'current@example.invalid', canLink: true, viaArchive: true }], restrictedMatches: true, blocked: false }); return }
      expect(Object.keys(body).sort()).toEqual((body.action === 'link' ? ['action', 'confirmed', 'expectedVersion', 'leadId', 'requestId'] : ['action', 'confirmed', 'expectedVersion', 'requestId']).sort()); expect(body.confirmed).toBe(true); expect(body.expectedVersion).toBe('a'.repeat(64))
      if (state.stale) { await error(409, 'EMAIL_MATCH_CHANGED', 'Matches changed. Refresh and review again.'); return }
      if (!state.receipt) { state.receipt = { messageId: id, requestId: body.requestId, action: body.action, leadId: body.action === 'link' ? body.leadId : null, stopped: body.action === 'link' ? 1 : 0, suggestionCreated: body.action === 'link' }; state.applied++ }
      if (state.lost) { state.lost = false; await route.abort('failed'); return }
      await reply(state.receipt); return
    }
    if (method === 'GET' && path === '/api/follow-ups') { await reply([]); return }
    if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(method)) { state.unexpected.push(`${method} ${path}`); await route.abort(); return }
    await route.continue()
  })
}
async function inspect(page: Page) { await page.getByRole('button', { name: 'Review match', exact: true }).click(); await expect(page.getByRole('radio', { name: /Retained Practice/ })).toBeVisible() }
async function choose(page: Page) { await page.getByRole('radio', { name: /Retained Practice/ }).check(); await page.getByRole('checkbox', { name: /I reviewed the message/ }).check() }
for (const width of [1280, 390]) test(`merge-aware replies requires reviewed linking at ${width}px`, async ({ page, baseURL }, info) => {
  const state = store(); await page.setViewportSize({ width, height: 900 }); await mock(page, baseURL!, state); await page.goto('/email-matches'); await inspect(page); await expect(page.getByRole('button', { name: 'Confirm email match' })).toBeDisabled(); await expect(page.getByRole('radio')).not.toBeChecked(); expect(state.applied).toBe(0); await expect(page.getByText('Other matches are unavailable in your current access.')).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath('email-match-review.png'), fullPage: true }); await page.getByRole('radio').focus(); await page.keyboard.press('Space'); await page.getByRole('checkbox', { name: /I reviewed the message/ }).focus(); await page.keyboard.press('Space'); await page.getByRole('button', { name: 'Confirm email match' }).focus(); await page.keyboard.press('Enter'); await expect(page.getByText(/Email linked/)).toBeVisible(); expect(state.applied).toBe(1); expect(state.calls).toHaveLength(2); expect(state.unexpected).toEqual([])
})
test('merge-aware replies rejects stale matches and clears revoked private previews', async ({ page, baseURL }) => {
  const state = store(); await mock(page, baseURL!, state); await page.goto('/email-matches'); await inspect(page); await choose(page); state.stale = true; await page.getByRole('button', { name: 'Confirm email match' }).click(); await expect(page.getByText('Matches changed. Refresh and review again.')).toBeVisible(); expect(state.applied).toBe(0); state.denied = true; await page.getByRole('button', { name: 'Review match', exact: true }).click(); await expect(page.getByRole('region', { name: 'Email match reviews', exact: true }).getByText(/Reload to check/)).toBeVisible(); await expect(page.getByRole('radio', { name: /Retained Practice/ })).toHaveCount(0); await expect(page.getByText(item.subject, { exact: true })).toHaveCount(0); expect(state.calls).toHaveLength(2); expect(state.unexpected).toEqual([])
})
test('merge-aware replies retries an uncertain update with the identical request', async ({ page, baseURL }) => {
  const state = store(); state.lost = true; await mock(page, baseURL!, state); await page.goto('/email-matches'); await inspect(page); await choose(page); await page.getByRole('button', { name: 'Confirm email match' }).click(); await expect(page.getByRole('button', { name: 'Retry confirmed update' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Confirm email match' })).toBeDisabled(); expect(state.applied).toBe(1); expect(state.calls).toHaveLength(2); await page.getByRole('button', { name: 'Retry confirmed update' }).click(); await expect(page.getByText(/Email linked/)).toBeVisible(); expect(state.calls[2].body).toEqual(state.calls[1].body); expect(state.applied).toBe(1); expect(state.unexpected).toEqual([])
})
test('merge-aware replies supports read-only inspection and rejects stale-account responses', async ({ page, baseURL }) => {
  const state = store(); await mock(page, baseURL!, state); await page.goto('/email-matches?readonly=true'); await inspect(page); await expect(page.getByRole('button', { name: 'Confirm email match' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Dismiss match review' })).toHaveCount(0); expect(state.applied).toBe(0); await page.goto('/email-matches'); await expect(page.getByRole('button', { name: 'Review match', exact: true })).toBeEnabled(); state.accountChanged = true; await page.getByRole('button', { name: 'Review match', exact: true }).click(); await expect(page.getByRole('region', { name: 'Email match reviews', exact: true }).getByText(/Reload to check/)).toBeVisible(); await expect(page.getByRole('radio')).toHaveCount(0); expect(state.applied).toBe(0); expect(state.unexpected).toEqual([])
})
test('merge-aware replies dismisses only after explicit acknowledgment without sending', async ({ page, baseURL }) => {
  const state = store(); await mock(page, baseURL!, state); await page.goto('/email-matches'); await inspect(page); await expect(page.getByRole('button', { name: 'Dismiss match review' })).toBeDisabled(); await page.getByRole('checkbox', { name: /I reviewed the message/ }).check(); await page.getByRole('button', { name: 'Dismiss match review' }).click(); await expect(page.getByText('Match review dismissed. No email was sent.', { exact: true })).toBeVisible(); expect(state.receipt).toMatchObject({ action: 'dismiss', leadId: null, stopped: 0, suggestionCreated: false }); expect(state.calls).toHaveLength(2); expect(state.unexpected).toEqual([])
})
