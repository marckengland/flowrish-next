import { expect, test } from '@playwright/test'
import type { KnowledgeGapGroup, KnowledgeGapOccurrence } from '../src/lib/knowledge-gaps'

const key = 'a'.repeat(64), reportId = '11111111-1111-4111-8111-111111111111', otherReportId = '22222222-2222-4222-8222-222222222222', documentId = '33333333-3333-4333-8333-333333333333', owner = '44444444-4444-4444-8444-444444444444', stage = '55555555-5555-4555-8555-555555555555'
const time = '2026-11-03T00:00:00.000Z'
const settings = { config: { enabled: false, businessName: 'Synthetic Bicycle Repairs', knowledge: '', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: owner, stageId: stage }, businessName: 'Synthetic Workspace', currentUserId: owner, members: [{ id: owner, name: 'Preview owner' }], stages: [{ id: stage, name: 'New', pipeline: { name: 'Sales' } }], calls: [], webhookPath: '/api/voice/receptionist/test' }

for (const mobile of [false, true]) {
  test(`reviews grouped saved questions with explicit retesting on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    let group: KnowledgeGapGroup = { key, version: 'b'.repeat(64), question: 'What are your Sunday opening hours?', occurrenceCount: 2, latestAt: time, status: 'open', changedSinceResolution: false, faqCounts: { draft: 0, published: 0, approved: 0, archived: 0 }, resolution: null }
    let occurrences: KnowledgeGapOccurrence[] = [reportId, otherReportId].map((rehearsalId, index) => ({ rehearsalId, title: index ? 'Another saved rehearsal' : 'Older saved rehearsal', messageIndex: 1, updatedAt: time, rehearsalUrl: `/settings?section=receptionist&rehearsal=${rehearsalId}`, faq: null }))
    let reads = 0, draftRequests = 0, reviewRequests = 0
    const unexpected: string[] = []
    const detail = () => ({ group, occurrences, page: 1, pageSize: 20, hasMore: false })
    await page.route('**/api/admin/ai-provider**', route => { unexpected.push('AI provider'); return route.fulfill({ status: 503, json: {} }) })
    await page.route('**/api/knowledge**', route => { unexpected.push('Knowledge write or publication'); return route.fulfill({ status: 503, json: {} }) })
    await page.route('**/api/admin/receptionist**', route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname
      if (path.endsWith('/knowledge-gaps')) {
        reads++
        const status = url.searchParams.get('status')
        return route.fulfill({ json: { data: { groups: status === 'all' || status === group.status ? [group] : [], page: 1, pageSize: 20, hasMore: false } } })
      }
      if (path.endsWith(`/knowledge-gaps/${key}/faq`)) {
        draftRequests++
        expect(request.postDataJSON()).toEqual({ expectedVersion: group.version })
        group = { ...group, version: 'c'.repeat(64), faqCounts: { draft: 1, published: 0, approved: 0, archived: 0 } }
        occurrences = occurrences.map((item, index) => index ? item : { ...item, faq: { documentId, title: 'Sunday opening hours FAQ', status: 'draft', knowledgeUrl: `/knowledge?document=${documentId}` } })
        return route.fulfill({ json: { data: { documentId, knowledgeUrl: `/knowledge?document=${documentId}`, created: true } } })
      }
      if (path.endsWith(`/knowledge-gaps/${key}`)) {
        if (request.method() === 'PATCH') {
          reviewRequests++
          const input = request.postDataJSON()
          expect(input.expectedVersion).toBe(group.version)
          if (reviewRequests === 1) {
            group = { ...group, version: 'd'.repeat(64) }
            return route.fulfill({ status: 409, json: { error: { code: 'KNOWLEDGE_GAP_CONFLICT', message: 'Saved data changed' } } })
          }
          if (input.action === 'resolve') {
            expect(input.retested).toBe(true)
            group = { ...group, version: 'e'.repeat(64), status: 'resolved', resolution: { notes: input.notes, resolvedAt: time } }
          } else {
            expect(input.action).toBe('reopen'); expect(input.retested).toBe(false)
            group = { ...group, version: 'f'.repeat(64), status: 'open', resolution: { notes: input.notes, resolvedAt: null } }
          }
        }
        return route.fulfill({ json: { data: detail() } })
      }
      if (path === '/api/admin/receptionist' && request.method() === 'GET') return route.fulfill({ json: settings })
      unexpected.push(path); return route.fulfill({ status: 503, json: {} })
    })
    await page.goto('/settings?section=receptionist')
    await expect(page.getByRole('button', { name: 'Load knowledge gaps', exact: true })).toBeVisible()
    expect(reads + reviewRequests + draftRequests).toBe(0)
    await page.getByRole('button', { name: 'Load knowledge gaps', exact: true }).click()
    await expect(page.getByText('2 occurrences', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: `Open question: ${group.question}`, exact: true }).click()
    await expect(page.getByRole('link', { name: 'Older saved rehearsal', exact: true })).toHaveAttribute('href', `/settings?section=receptionist&rehearsal=${reportId}`)
    await expect(page.getByRole('button', { name: 'Resolve gap', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Create or open FAQ draft', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Open FAQ draft', exact: true })).toHaveAttribute('href', `/knowledge?document=${documentId}`)
    await expect(page.getByRole('link', { name: 'Sunday opening hours FAQ (draft)', exact: true })).toBeVisible()
    expect(draftRequests).toBe(1); expect(reviewRequests).toBe(0)
    await page.getByRole('textbox', { name: 'Resolution notes', exact: true }).fill('Retested the saved question with approved business information.')
    await page.getByRole('checkbox', { name: 'I manually retested this question', exact: true }).check()
    await page.getByRole('button', { name: 'Resolve gap', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Your local notes and retest confirmation are kept' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'I manually retested this question', exact: true })).toBeChecked()
    await expect(page.getByRole('textbox', { name: 'Resolution notes', exact: true })).toHaveValue('Retested the saved question with approved business information.')
    await expect(page.getByRole('button', { name: 'Resolve gap', exact: true })).toBeDisabled()
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Reload latest question', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: 'I manually retested this question', exact: true })).not.toBeChecked()
    await page.getByRole('textbox', { name: 'Resolution notes', exact: true }).fill('Reviewed and manually retested.')
    await page.getByRole('checkbox', { name: 'I manually retested this question', exact: true }).check()
    await page.getByRole('button', { name: 'Resolve gap', exact: true }).click()
    await expect(page.getByText('Gap status: Resolved', { exact: true })).toBeVisible()
    await expect(page.getByText('Gap resolved after your manual retest. Report flags and FAQ publication are unchanged.', { exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: 'Knowledge gap status', exact: true }).selectOption('resolved')
    await page.getByRole('button', { name: `Open question: ${group.question}`, exact: true }).click()
    await page.getByRole('button', { name: 'Reopen gap', exact: true }).click()
    await expect(page.getByText('Gap status: Open', { exact: true })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'I manually retested this question', exact: true })).not.toBeChecked()
    await expect(page.getByRole('button', { name: 'Resolve gap', exact: true })).toBeDisabled()
    if (mobile) await expect(page.getByRole('complementary', { name: 'Primary navigation' })).not.toBeInViewport()
    expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('textbox', { name: 'Resolution notes', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `/tmp/flowrish-gaps-${mobile ? 'mobile' : 'desktop'}.png` })
    expect(reviewRequests).toBe(3)
    expect(unexpected).toEqual([])
    expect(occurrences[0].faq?.status).toBe('draft')
  })
}
