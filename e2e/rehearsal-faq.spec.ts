import { expect, test } from '@playwright/test'
import { initialCallState } from '../src/lib/receptionist'

const reportId = '11111111-1111-4111-8111-111111111111', documentId = '22222222-2222-4222-8222-222222222222', owner = '33333333-3333-4333-8333-333333333333', stage = '44444444-4444-4444-8444-444444444444'
const version = '2026-11-02T01:00:00.000Z'
const report = { id: reportId, title: 'Sunday hours test', verdict: 'needs_work', notes: 'Private review note.', unansweredMessageIndexes: [1], createdAt: version, updatedAt: version, snapshot: { clientId: reportId, settingsVersion: version, finished: false, messages: [
  { role: 'receptionist', content: 'Hello from the synthetic bicycle shop.', sources: [], generation: 'scripted' },
  { role: 'caller', content: 'What are your Sunday opening hours?', sources: [], generation: 'scripted' },
] } }
const settings = { config: { enabled: false, businessName: 'Synthetic Bicycle Repairs', knowledge: '', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: owner, stageId: stage }, businessName: 'Synthetic Workspace', currentUserId: owner, members: [{ id: owner, name: 'Preview owner' }], stages: [{ id: stage, name: 'New', pipeline: { name: 'Sales' } }], calls: [], webhookPath: '/api/voice/receptionist/test' }

for (const mobile of [false, true]) {
  test(`closes the flagged-question FAQ loop with explicit publication on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    let document = { id: documentId, title: 'FAQ: What are your Sunday opening hours?', category: 'FAQ', contentText: 'Question: What are your Sunday opening hours?\n\nAnswer:\n', sourceName: null, sourceMime: null, revision: 1, publishedTitle: null as string | null, publishedCategory: null as string | null, publishedText: null as string | null, publishedRevision: null as number | null, publishedAt: null as string | null, receptionistApprovedRevision: null as number | null, archivedAt: null }
    let created = false, creations = 0, requests = 0, previews = 0
    const publication: string[] = [], unexpected: string[] = []
    await page.route('**/api/admin/ai-provider**', route => { unexpected.push('AI provider'); return route.fulfill({ status: 503, json: {} }) })
    await page.route('**/api/admin/receptionist**', route => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith(`/rehearsals/${reportId}/faq`)) {
        requests++
        expect(route.request().postDataJSON()).toEqual({ messageIndex: 1, expectedUpdatedAt: version })
        const isNew = !created
        if (isNew) { created = true; creations++ }
        return route.fulfill({ json: { data: { documentId, knowledgeUrl: `/knowledge?document=${documentId}`, created: isNew } } })
      }
      if (path.endsWith(`/rehearsals/${reportId}`)) return route.fulfill({ json: { data: report } })
      if (path === '/api/admin/receptionist') return route.fulfill({ json: settings })
      if (path.endsWith('/preview')) {
        previews++
        const input = route.request().postDataJSON()
        return route.fulfill({ json: { data: { state: initialCallState(''), settingsVersion: version, finished: false, callback: null, sources: [], reply: input.state ? 'We open Sundays from 10 AM to 2 PM.' : 'Thank you for calling Synthetic Bicycle Repairs.' } } })
      }
      unexpected.push(path); return route.fulfill({ status: 503, json: {} })
    })
    await page.route('**/api/knowledge**', route => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith(`/${documentId}/rehearsal`)) return route.fulfill({ json: { data: { rehearsalId: reportId, title: report.title, messageIndex: 1, rehearsalUrl: `/settings?section=receptionist&rehearsal=${reportId}` } } })
      if (path === '/api/knowledge') return route.fulfill({ json: { data: created ? [document] : [] } })
      if (path.endsWith(`/${documentId}/publish`)) {
        const { action } = route.request().postDataJSON()
        publication.push(action)
        if (action === 'publish') document = { ...document, publishedTitle: document.title, publishedCategory: document.category, publishedText: document.contentText, publishedRevision: document.revision, publishedAt: version, receptionistApprovedRevision: null }
        else if (action === 'approve_receptionist') document = { ...document, receptionistApprovedRevision: document.publishedRevision }
        else unexpected.push(action)
        return route.fulfill({ json: { data: document } })
      }
      if (path.endsWith(`/${documentId}`)) {
        if (route.request().method() === 'PATCH') { const input = route.request().postDataJSON(); document = { ...document, ...input, revision: document.revision + 1 } }
        return route.fulfill({ json: { data: document } })
      }
      unexpected.push(path); return route.fulfill({ status: 503, json: {} })
    })
    await page.goto(`/settings?section=receptionist&rehearsal=${reportId}`)
    await expect(page.getByRole('heading', { name: report.title, exact: true })).toBeVisible()
    expect(previews).toBe(0); expect(requests).toBe(0)
    await page.getByRole('button', { name: 'Create FAQ draft', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Open FAQ draft', exact: true })).toHaveAttribute('href', `/knowledge?document=${documentId}`)
    expect(publication).toEqual([])
    await page.getByRole('link', { name: 'Open FAQ draft', exact: true }).click()
    await expect(page).toHaveURL(new URL(`/knowledge?document=${documentId}`, page.url()).href)
    await expect(page.getByRole('textbox', { name: 'Document text', exact: true })).toHaveValue('Question: What are your Sunday opening hours?\n\nAnswer:\n')
    await expect(page.getByRole('combobox', { name: 'Category', exact: true })).toHaveValue('FAQ')
    const answer = 'Question: What are your Sunday opening hours?\n\nAnswer: We open Sundays from 10 AM to 2 PM.'
    await page.getByRole('textbox', { name: 'Document text', exact: true }).fill(answer)
    await expect(page.getByRole('button', { name: `Open rehearsal: ${report.title}`, exact: true })).toBeDisabled()
    await expect(page.getByRole('link', { name: `Open rehearsal: ${report.title}`, exact: true })).toHaveCount(0)
    await expect(page).toHaveURL(new URL(`/knowledge?document=${documentId}`, page.url()).href)
    await expect(page.getByRole('textbox', { name: 'Document text', exact: true })).toHaveValue(answer)
    expect(publication).toEqual([])
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByText('Draft saved. Publish it when the text is ready for Airish.', { exact: true })).toBeVisible()
    expect(document.receptionistApprovedRevision).toBeNull()
    await page.getByRole('button', { name: 'Publish for Airish', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Approve for receptionist', exact: true })).toBeDisabled()
    expect(document.receptionistApprovedRevision).toBeNull()
    await page.getByRole('checkbox', { name: 'I reviewed the published snapshot above and approve this revision for callers to the public AI receptionist.', exact: true }).check()
    await page.getByRole('button', { name: 'Approve for receptionist', exact: true }).click()
    await expect(page.getByText('Published snapshot approved for the receptionist.', { exact: true })).toBeVisible()
    expect(publication).toEqual(['publish', 'approve_receptionist'])
    expect(document.contentText).not.toContain(report.notes)
    expect(document.contentText).not.toContain('/settings')
    if (mobile) await expect(page.getByRole('complementary', { name: 'Primary navigation' })).not.toBeInViewport()
    expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('link', { name: `Open rehearsal: ${report.title}`, exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `/tmp/flowrish-faq-${mobile ? 'mobile' : 'desktop'}.png` })
    await page.getByRole('link', { name: `Open rehearsal: ${report.title}`, exact: true }).click()
    await expect(page.getByRole('heading', { name: report.title, exact: true })).toBeVisible()
    expect(previews).toBe(0)
    await page.getByRole('button', { name: 'Create FAQ draft', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Open FAQ draft', exact: true })).toBeVisible()
    expect(requests).toBe(2); expect(creations).toBe(1)
    await page.getByRole('button', { name: 'Start browser preview', exact: true }).click()
    await page.getByRole('textbox', { name: 'Caller message', exact: true }).fill('What are your Sunday opening hours?')
    await page.getByRole('button', { name: 'Send caller message', exact: true }).click()
    await expect(page.getByRole('log')).toContainText('10 AM to 2 PM')
    expect(previews).toBe(2)
    expect(unexpected).toEqual([])
  })
}
