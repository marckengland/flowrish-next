import { expect, test } from '@playwright/test'
import { setupFixture } from '../src/components/settings/receptionist-setup-fixture.test-data'

for (const mobile of [false, true]) {
  test(`guides business onboarding with mocked writes on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    const state = setupFixture(); state.business.saved = false; state.business.updatedAt = null; state.website.settings = null; state.website.hasSavedBusiness = false; state.website.approvedDocuments = 0; state.knowledge = { total: 0, published: 0, approved: 0, approvedCategories: [], sample: null }; state.readyToEnable = false
    let generation = 0, launches = 0, profileSaves = 0, websiteSaves = 0, extracts = 0
    let document: Record<string, unknown> | null = null
    const unexpected: string[] = []
    const change = () => { state.version = (++generation).toString(16).padStart(64, '0'); state.readyToEnable = state.business.saved && state.knowledge.approved > 0 && !!state.website.settings?.allowedOrigins.length && state.website.hasOrganizationAi }
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (/\/(?:api\/(?:ai|voice|calling|public\/website-receptionist|admin\/ai-provider)|receptionist-widget(?:-frame)?\.js)(?:\/|$)/.test(url.pathname) || /(^|\.)(?:deepseek\.com|openai\.com|anthropic\.com|googleapis\.com|tokenrouter\.com|openrouter\.ai|twilio\.com)$/.test(url.hostname) || (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method()))) { unexpected.push(`${request.method()} ${url.pathname}`); await route.fulfill({ status: 503, json: {} }); return }
      await route.continue()
    })
    await page.route('**/api/admin/receptionist/setup**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (path.endsWith('/setup') && request.method() === 'GET') { await route.fulfill({ json: { data: state } }); return }
      if (path.endsWith('/business') && request.method() === 'PATCH') { profileSaves++; const body = request.postDataJSON(); expect(Object.keys(body).sort()).toEqual(['expectedUpdatedAt', 'values']); expect(body.expectedUpdatedAt).toBe(null); state.business = { ...state.business, values: body.values, saved: true, updatedAt: state.checkedAt }; state.website.hasSavedBusiness = true; change(); await route.fulfill({ json: { data: state } }); return }
      if (path.endsWith('/launch') && request.method() === 'POST') { launches++; expect(request.postDataJSON()).toEqual({ expectedVersion: state.version, simulationReviewed: true, acknowledged: true }); expect(state.readyToEnable).toBe(true); state.website.settings!.enabled = true; change(); await route.fulfill({ json: { data: state } }); return }
      unexpected.push(`${request.method()} ${path}`); await route.fulfill({ status: 503, json: {} })
    })
    await page.route('**/api/admin/receptionist', route => route.fulfill({ json: { config: null, businessName: 'Synthetic Workspace', currentUserId: '33333333-3333-4333-8333-333333333333', members: [], stages: [], calls: [], webhookPath: '/api/voice/receptionist/test' } }))
    await page.route('**/api/knowledge**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (path === '/api/knowledge/extract' && request.method() === 'POST') { extracts++; await route.fulfill({ json: { data: { contentText: 'Bicycle tune-ups cost 500 pesos after inspection approval.', sourceName: 'Sample pricing.txt', sourceMime: 'text/plain', warnings: [] } } }); return }
      if (path === '/api/knowledge' && request.method() === 'GET') { await route.fulfill({ json: { data: document ? [document] : [] } }); return }
      if (path === '/api/knowledge' && request.method() === 'POST') { document = { ...request.postDataJSON(), id: '22222222-2222-4222-8222-222222222222', revision: 1, publishedTitle: null, publishedCategory: null, publishedText: null, publishedRevision: null, publishedAt: null, receptionistApprovedRevision: null, archivedAt: null }; state.knowledge.total = 1; change(); await route.fulfill({ json: { data: document } }); return }
      if (document && path.endsWith('/publish')) { const body = request.postDataJSON(); expect(body.revision).toBe(1); if (body.action === 'publish') { Object.assign(document, { publishedTitle: document.title, publishedCategory: document.category, publishedText: document.contentText, publishedRevision: 1, publishedAt: state.checkedAt }); state.knowledge.published = 1 } else { expect(body.action).toBe('approve_receptionist'); expect(body.acknowledged).toBe(true); expect(body.publishedRevision).toBe(1); document.receptionistApprovedRevision = 1; state.knowledge.approved = 1; state.knowledge.approvedCategories = ['PRICING']; state.knowledge.sample = { category: 'PRICING', text: String(document.contentText) }; state.website.approvedDocuments = 1 } change(); await route.fulfill({ json: { data: document } }); return }
      unexpected.push(`${request.method()} ${path}`); await route.fulfill({ status: 503, json: {} })
    })
    await page.route('**/api/admin/website-receptionist**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (path === '/api/admin/website-receptionist' && request.method() === 'PUT') { websiteSaves++; const body = request.postDataJSON(); expect(body.enabled).toBe(false); expect(body.expectedUpdatedAt).toBe(null); state.website.settings = { publicId: '11111111-1111-4111-8111-111111111111', enabled: false, allowedOrigins: body.allowedOrigins, dailyMessageLimit: body.dailyMessageLimit, dailyTokenLimit: body.dailyTokenLimit, dailyCallbackLimit: body.dailyCallbackLimit, updatedAt: state.checkedAt }; change(); await route.fulfill({ json: { data: state.website } }); return }
      unexpected.push(`${request.method()} ${path}`); await route.fulfill({ status: 503, json: {} })
    })
    await page.goto('/settings?section=receptionist'); await page.getByRole('link', { name: 'Open guided website setup', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Set up your business receptionist' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Business name', exact: true }).fill('Synthetic Bicycle Repairs')
    page.once('dialog', async dialog => { expect(dialog.type()).toBe('confirm'); await dialog.dismiss() }); await page.evaluate(() => history.back()); await expect(page.getByRole('textbox', { name: 'Business name', exact: true })).toHaveValue('Synthetic Bicycle Repairs'); await expect(page).toHaveURL(/\/receptionist\/setup$/)
    page.once('dialog', async dialog => { expect(dialog.type()).toBe('confirm'); await dialog.accept() }); await page.evaluate(() => history.back()); await expect(page).toHaveURL(/\/settings\?section=receptionist$/); await page.getByRole('link', { name: 'Open guided website setup', exact: true }).click(); await page.getByRole('textbox', { name: 'Business name', exact: true }).fill('Synthetic Bicycle Repairs')
    await page.getByRole('button', { name: 'Save business details', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Business details saved.' })).toBeVisible()
    await page.getByRole('button', { name: 'Next step', exact: true }).click(); await expect(page.getByText('No documents yet. Add pricing, services, or FAQs to get started.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Use saved hours in a new draft' }).click(); await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveValue(/Business hours \(Asia\/Manila\)/)
    await page.getByRole('button', { name: '3. Website & budget', exact: true }).click(); await expect(page.getByRole('alertdialog')).toBeVisible(); await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await page.getByLabel('Upload document', { exact: true }).setInputFiles({ name: 'Sample pricing.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic pricing') }); await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveValue('Bicycle tune-ups cost 500 pesos after inspection approval.')
    await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('PRICING'); await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await expect(page.getByText('Draft saved. Publish it when the text is ready for Airish.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Publish for Airish', exact: true }).click(); await expect(page.getByRole('button', { name: 'Approve for receptionist', exact: true })).toBeDisabled(); await page.getByRole('checkbox', { name: /I reviewed the published snapshot/ }).check(); await page.getByRole('button', { name: 'Approve for receptionist', exact: true }).click(); await expect(page.getByText('Published snapshot approved for the receptionist.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next step', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Next step', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: 'Enable website receptionist', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Load callback requests', exact: true })).toHaveCount(0)
    await page.getByRole('textbox', { name: 'Allowed website origins', exact: true }).fill('https://shop.example'); await page.getByRole('button', { name: 'Save website receptionist settings', exact: true }).click(); await expect(page.getByText('Website receptionist settings saved.', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Next step', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Next step', exact: true }).click()
    const callsBefore = { profileSaves, websiteSaves, extracts, launches }
    await page.getByRole('button', { name: 'Run local simulation', exact: true }).click(); await expect(page.getByText('Bicycle tune-ups cost 500 pesos after inspection approval.', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Confirm simulated callback' })).toBeDisabled(); await page.getByRole('checkbox', { name: /I reviewed these sample/ }).check(); await page.getByRole('button', { name: 'Confirm simulated callback' }).click(); await expect(page.getByText('Simulation reviewed for this saved setup. No callback was submitted.', { exact: true })).toBeVisible(); expect({ profileSaves, websiteSaves, extracts, launches }).toEqual(callsBefore)
    await expect(page.locator('pre code')).toContainText('data-flowrish-receptionist'); await page.getByRole('button', { name: 'Next step', exact: true }).click(); const enable = page.getByRole('button', { name: 'Enable website receptionist', exact: true }); await expect(enable).toBeDisabled(); expect(launches).toBe(0)
    await page.getByRole('checkbox', { name: /I understand this simulation/ }).check(); await page.getByRole('checkbox', { name: /I approve the saved websites/ }).check(); await enable.click(); await expect(page.getByText('Your website receptionist is enabled.', { exact: true })).toBeVisible()
    expect(launches).toBe(1); expect(profileSaves).toBe(1); expect(websiteSaves).toBe(1); expect(extracts).toBe(1); expect(unexpected).toEqual([]); await expect(page.locator('script[src*="receptionist-widget"],iframe[src*="website-receptionist"]')).toHaveCount(0); expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `/tmp/flowrish-setup-${mobile ? 'mobile' : 'desktop'}.png` })
  })
}
