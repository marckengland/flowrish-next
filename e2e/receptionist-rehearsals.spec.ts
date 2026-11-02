import { expect, test } from '@playwright/test'
import { initialCallState } from '../src/lib/receptionist'
import type { RehearsalReport } from '../src/lib/receptionist-rehearsal'

const owner = '11111111-1111-4111-8111-111111111111'
const stage = '22222222-2222-4222-8222-222222222222'
const reportId = '33333333-3333-4333-8333-333333333333'
const version = '2026-11-02T01:00:00.000Z'
const source = { id: '44444444-4444-4444-8444-444444444444', title: 'Synthetic approved prices', revision: 2 }
const settings = { config: { enabled: false, businessName: 'Synthetic Bicycle Repairs', knowledge: '', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: owner, stageId: stage }, businessName: 'Synthetic Workspace', currentUserId: owner, members: [{ id: owner, name: 'Preview owner' }], stages: [{ id: stage, name: 'New', pipeline: { name: 'Sales' } }], calls: [], webhookPath: '/api/voice/receptionist/test' }

for (const mobile of [false, true]) {
  test(`explicitly saves, reviews, reopens and deletes a mocked rehearsal on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    let saved: RehearsalReport | null = null
    let saves = 0, previews = 0, patches = 0, deletes = 0, historyReads = 0
    const unexpected: string[] = []
    await page.route('**/api/admin/ai-provider**', route => { unexpected.push('AI provider endpoint'); return route.fulfill({ status: 503, json: {} }) })
    await page.route('**/api/admin/receptionist**', route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (path.endsWith('/preview')) {
        previews++
        const input = request.postDataJSON()
        return route.fulfill({ json: { data: { state: initialCallState(''), settingsVersion: version, reply: input.state ? 'That service is not in the approved prices. I can take a callback request.' : 'Thank you for calling Synthetic Bicycle Repairs.', finished: false, callback: null, sources: input.state ? [source] : [], ...(input.state ? { generation: { mode: 'ai' } } : {}) } } })
      }
      if (path.endsWith('/rehearsals')) {
        if (request.method() === 'POST') {
          saves++
          saved = { id: reportId, ...request.postDataJSON(), createdAt: version, updatedAt: version, verdict: 'unreviewed', notes: '', unansweredMessageIndexes: [] }
          return route.fulfill({ json: { data: saved } })
        }
        historyReads++
        return route.fulfill({ json: { data: saved ? [saved] : [] } })
      }
      if (path.endsWith(`/rehearsals/${reportId}`)) {
        if (request.method() === 'DELETE') { deletes++; saved = null; return route.fulfill({ json: { data: { deleted: true } } }) }
        if (request.method() === 'PATCH') {
          patches++
          if (patches === 1) return route.fulfill({ status: 409, json: { error: { message: 'Review changed' } } })
          const { expectedUpdatedAt, ...review } = request.postDataJSON()
          expect(expectedUpdatedAt).toBe(version)
          saved = { ...saved!, ...review, updatedAt: '2026-11-02T02:00:00.000Z' }
        }
        return route.fulfill({ json: { data: saved } })
      }
      if (path === '/api/admin/receptionist' && request.method() === 'GET') return route.fulfill({ json: settings })
      unexpected.push(path)
      return route.fulfill({ status: 503, json: {} })
    })
    await page.goto('/settings')
    await page.getByRole('button', { name: 'AI receptionist', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save rehearsal', exact: true })).toBeDisabled()
    expect(previews + saves + historyReads).toBe(0)
    await page.getByRole('button', { name: 'Start browser preview', exact: true }).click()
    await page.getByRole('button', { name: 'Unknown answer', exact: true }).click()
    await page.getByRole('button', { name: 'Send caller message', exact: true }).click()
    await expect(page.getByRole('log')).toContainText('not in the approved prices')
    expect(saves).toBe(0)
    await page.getByRole('textbox', { name: 'Rehearsal title', exact: true }).fill('Unknown price rehearsal')
    await page.getByRole('button', { name: 'Save rehearsal', exact: true }).click()
    await expect(page.getByText('Rehearsal saved.', { exact: true })).toBeVisible()
    expect(saves).toBe(1)
    expect(saved!.snapshot.messages[2].sources).toEqual([source])
    await expect(page.getByRole('list', { name: 'Saved rehearsal transcript' })).toContainText('Synthetic approved prices · revision 2')
    await page.getByRole('combobox', { name: 'Manual review verdict', exact: true }).selectOption('needs_work')
    await page.getByRole('checkbox', { name: 'Needs knowledge for caller message 2', exact: true }).check()
    await page.getByRole('textbox', { name: 'Review notes', exact: true }).fill('Add the unlisted service.')
    await page.getByRole('button', { name: 'Save review', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Another reviewer updated this rehearsal' })).toContainText('Your edits are still here')
    await expect(page.getByRole('textbox', { name: 'Review notes' })).toHaveValue('Add the unlisted service.')
    await page.getByRole('button', { name: 'Reload latest rehearsal', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Review notes' })).toHaveValue('')
    await page.getByRole('combobox', { name: 'Manual review verdict' }).selectOption('needs_work')
    await page.getByRole('checkbox', { name: 'Needs knowledge for caller message 2', exact: true }).check()
    await page.getByRole('textbox', { name: 'Review notes' }).fill('Add the unlisted service.')
    await page.getByRole('button', { name: 'Save review', exact: true }).click()
    await expect(page.getByText('Review saved.', { exact: true })).toBeVisible()
    expect(saved!.verdict).toBe('needs_work')
    expect(saved!.unansweredMessageIndexes).toEqual([1])
    await expect(page.getByRole('link', { name: 'Open knowledge library', exact: true })).toHaveAttribute('href', '/knowledge')
    await page.getByRole('button', { name: 'Load saved rehearsals', exact: true }).click()
    await page.getByRole('button', { name: 'Open Unknown price rehearsal', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Review notes' })).toHaveValue('Add the unlisted service.')
    if (mobile) await expect(page.getByRole('complementary', { name: 'Primary navigation' })).not.toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('textbox', { name: 'Review notes', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `/tmp/flowrish-rehearsal-${mobile ? 'mobile' : 'desktop'}.png` })
    await page.getByRole('button', { name: 'Delete saved rehearsal', exact: true }).click()
    expect(deletes).toBe(0)
    await page.getByRole('button', { name: 'Cancel deletion', exact: true }).click()
    expect(deletes).toBe(0)
    await page.getByRole('button', { name: 'Delete saved rehearsal', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm deletion', exact: true }).click()
    await expect(page.getByText('Rehearsal deleted.', { exact: true })).toBeVisible()
    expect(deletes).toBe(1)
    expect(previews).toBe(2)
    expect(unexpected).toEqual([])
  })
}
