import { test, expect } from '@playwright/test'
import { docx, pdf } from './fixtures/knowledge-files'

interface SyntheticDocument { id: string; title: string; category: string; contentText: string; revision: number; publishedTitle: string | null; publishedCategory: string | null; publishedText: string | null; publishedRevision: number | null; publishedAt: string | null; receptionistApprovedRevision: number | null; archivedAt: string | null }

test.setTimeout(60_000)
test.use({ actionTimeout: 10_000 })

test('reviews synthetic text before publishing and separately approving public receptionist use', async ({ page }) => {
  let record: SyntheticDocument | null = null
  const actions: string[] = []
  await page.route('**/api/knowledge**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET') return route.fulfill({ json: { data: path === '/api/knowledge' ? (record ? [record] : []) : record } })
    const input = request.postDataJSON()
    if (path === '/api/knowledge') record = { ...input, id: '11111111-1111-4111-8111-111111111111', revision: 1, publishedTitle: null, publishedCategory: null, publishedText: null, publishedRevision: null, publishedAt: null, receptionistApprovedRevision: null, archivedAt: null }
    else if (request.method() === 'PATCH') record = { ...record, ...input, revision: record!.revision + 1 }
    else {
      actions.push(input.action)
      expect(input.revision).toBe(record!.revision)
      if (input.action === 'publish') record = { ...record!, revision: record!.revision + 1, publishedRevision: record!.revision + 1, publishedAt: '2026-11-02T00:00:00Z', publishedTitle: record!.title, publishedCategory: record!.category, publishedText: record!.contentText, receptionistApprovedRevision: null }
      else if (input.action === 'approve_receptionist') {
        expect(input.acknowledged).toBe(true)
        expect(input.publishedRevision).toBe(record!.publishedRevision)
        record = { ...record!, revision: record!.revision + 1, receptionistApprovedRevision: record!.publishedRevision }
      } else throw new Error(`Unexpected synthetic transition ${input.action}`)
    }
    return route.fulfill({ json: { data: record } })
  })
  await page.goto('/knowledge')
  await expect(page.getByRole('heading', { name: 'Knowledge library', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await page.getByRole('textbox', { name: 'Document title', exact: true }).fill('Consultation pricing')
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('PRICING')
  await page.getByRole('textbox', { name: 'Document text', exact: true }).fill('A consultation costs 99 dollars.')
  await expect(page.getByRole('button', { name: 'Publish for Airish', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.getByRole('button', { name: 'Publish for Airish', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Published revision 2', exact: true })).toBeVisible()
  const approve = page.getByRole('button', { name: 'Approve for receptionist', exact: true })
  await expect(approve).toBeDisabled()
  await page.getByRole('region', { name: 'Published snapshot', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: '/tmp/flowrish-knowledge-published-approval.png', fullPage: true })
  await page.getByRole('checkbox', { name: /I reviewed the published snapshot/ }).check()
  await approve.click()
  await expect(page.getByText('Receptionist approved · revision 2', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Document text', exact: true }).fill('A consultation costs 120 dollars.')
  await expect(page.getByRole('region', { name: 'Published snapshot', exact: true })).toContainText('A consultation costs 99 dollars.')
  await expect(page.getByText(/Unpublished changes/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish for Airish', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.getByRole('button', { name: 'Publish for Airish', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Published revision 5', exact: true })).toBeVisible()
  await expect(page.getByText('Receptionist approved · revision 2', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: /I reviewed the published snapshot/ })).not.toBeChecked()
  await expect(approve).toBeDisabled()
  expect(actions).toEqual(['publish', 'approve_receptionist', 'publish'])
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('uploads synthetic text for review without automatically saving or publishing', async ({ page }) => {
  let extracts = 0
  let saves = 0
  await page.route('**/api/knowledge**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: [] } })
    if (new URL(route.request().url()).pathname.endsWith('/extract')) {
      extracts++
      expect(route.request().headers()['content-type']).toContain('multipart/form-data')
      return route.fulfill({ json: { data: { contentText: 'We offer synthetic consultations.', sourceName: 'services.txt', sourceMime: 'text/plain', warnings: ['Review extracted text before publication.'] } } })
    }
    saves++
    throw new Error('An upload must not save or publish without an explicit action')
  })
  await page.goto('/knowledge')
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await page.getByLabel('Upload document', { exact: true }).setInputFiles({ name: 'services.txt', mimeType: 'text/plain', buffer: Buffer.from('We offer synthetic consultations.') })
  await expect(page.getByRole('textbox', { name: 'Document text', exact: true })).toHaveValue('We offer synthetic consultations.')
  await expect(page.getByText('Review extracted text before publication.', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Document text', exact: true }).fill('My reviewed synthetic services text.')
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Document text', exact: true })).toHaveValue('My reviewed synthetic services text.')
  expect(extracts).toBe(1)
  expect(saves).toBe(0)
})

for (const fixture of [
  { name: 'synthetic-pricing.pdf', mimeType: 'application/pdf', buffer: pdf('Synthetic consultation costs 99 dollars.'), expected: 'Synthetic consultation costs 99 dollars.' },
  { name: 'synthetic-services.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx('Synthetic consultations are available.') , expected: 'Synthetic consultations are available.' },
]) test(`extracts a synthetic ${fixture.name.endsWith('.pdf') ? 'PDF' : 'DOCX'} through the real upload endpoint without persisting a document`, async ({ request }) => {
  const before = await request.get('/api/knowledge')
  expect(before.status()).toBe(200)
  const previous = (await before.json()).data.map((row: { id: string }) => row.id).sort()
  const response = await request.post('/api/knowledge/extract', { multipart: { file: { name: fixture.name, mimeType: fixture.mimeType, buffer: fixture.buffer } } })
  expect(response.status(), await response.text()).toBe(200)
  const result = (await response.json()).data
  expect(result.contentText).toContain(fixture.expected)
  expect(result.sourceName).toBe(fixture.name)
  const after = await request.get('/api/knowledge')
  expect(after.status()).toBe(200)
  expect((await after.json()).data.map((row: { id: string }) => row.id).sort()).toEqual(previous)
})

test('knowledge management and upload extraction require authentication', async ({ playwright, baseURL }) => {
  const external = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    expect((await external.get('/api/knowledge')).status()).toBe(401)
    expect((await external.post('/api/knowledge/extract', { multipart: { file: { name: 'synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic services') } } })).status()).toBe(401)
  } finally { await external.dispose() }
})
