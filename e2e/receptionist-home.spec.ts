import { expect, test } from '@playwright/test'
import { homeFixture } from '../src/components/receptionist/home-fixture.test-data'
import { setupFixture } from '../src/components/settings/receptionist-setup-fixture.test-data'

for (const mobile of [false, true]) {
  test(`Receptionist home stays read-only with role-filtered snapshots on ${mobile ? 'mobile dark' : 'desktop light'}`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1080 })
    await page.addInitScript(dark => { localStorage.setItem('flowrish:theme', dark ? 'dark' : 'light') }, mobile)
    const unexpected: string[] = []; let reads = 0, status = 200, snapshot = homeFixture()
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (/\/(?:api\/(?:ai|voice|calling|public\/website-receptionist|admin\/ai-provider|inngest))(?:\/|$)/.test(url.pathname) || url.pathname === '/receptionist-widget.js' || /(^|\.)(?:deepseek\.com|openai\.com|anthropic\.com|googleapis\.com|openrouter\.ai|tokenrouter\.com|twilio\.com)$/.test(url.hostname) || (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method()))) { unexpected.push(`${request.method()} ${url.pathname}`); await route.fulfill({ status: 503, json: {} }); return }
      await route.continue()
    })
    await page.route('**/api/receptionist/home', route => { reads++; expect(route.request().method()).toBe('GET'); return route.fulfill({ status, headers: { 'Cache-Control': 'no-store' }, json: status === 200 ? { data: snapshot } : { error: { message: 'PRIVATE provider diagnostic' } } }) })
    await page.route('**/api/admin/receptionist/setup', route => route.fulfill({ json: { data: setupFixture() } }))
    await page.goto('/receptionist')
    await expect(page.getByRole('heading', { name: 'Sample Repairs', exact: true })).toBeVisible()
    await expect(page.getByText('Saved setup prerequisites complete', { exact: true })).toBeVisible(); await expect(page.getByText('Website switch: Off', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Callback work queue', exact: true })).toHaveAttribute('href', '/tasks#callback-work')
    await expect(page.getByRole('link', { name: 'Receptionist performance', exact: true })).toHaveAttribute('href', '/callbacks/performance')
    expect(reads).toBe(1); expect(unexpected).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `/tmp/flowrish-home-${mobile ? 'mobile-dark' : 'desktop-light'}.png`, fullPage: true })
    const refresh = page.getByRole('button', { name: 'Refresh receptionist home', exact: true })
    snapshot = homeFixture(false, true); await refresh.click()
    await expect(page.getByRole('heading', { name: 'Sample Organization', exact: true })).toBeVisible(); await expect(page.getByText('Your assigned callback work', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Continue setup', exact: true })).toHaveCount(0); await expect(page.getByRole('link', { name: 'Check website installation', exact: true })).toHaveCount(0); await expect(page.getByRole('link', { name: 'Receptionist performance', exact: true })).toHaveCount(0)
    snapshot = homeFixture(true, false); await refresh.click(); await expect(page.getByRole('link', { name: 'Continue setup', exact: true })).toBeVisible(); await expect(page.getByRole('link', { name: 'Callback work queue', exact: true })).toHaveCount(0)
    status = 403; await refresh.click(); await expect(page.getByRole('main').getByRole('alert')).toContainText('current organization'); await expect(page.getByRole('heading', { name: 'Sample Repairs', exact: true })).toHaveCount(0); await expect(page.getByText(/PRIVATE provider diagnostic/)).toHaveCount(0)
    status = 200; snapshot = homeFixture(); snapshot.targets = { enabled: false, checkedAt: null }; snapshot.counts = { pendingHandoffs: 0, openCallbacks: 0, overdueCallbacks: 0, missedHandoffs: 0, missedContacts: 0 }; await refresh.click()
    await expect(page.getByText('No callback work in this view.', { exact: true })).toBeVisible(); await expect(page.getByText(/Response targets are paused/)).toBeVisible(); expect(reads).toBe(5)
    await page.getByRole('link', { name: 'Check website installation', exact: true }).click(); await expect(page).toHaveURL(/\/receptionist\/setup\?step=installation$/)
    await expect(page.getByRole('button', { name: '4. Simulation', exact: true })).toHaveAttribute('aria-current', 'step'); await expect(page.getByRole('button', { name: 'Check website installation', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '5. Review & enable', exact: true }).click(); await expect(page.getByRole('button', { name: 'Enable website receptionist', exact: true })).toBeDisabled()
    await page.getByRole('link', { name: 'Receptionist home', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Sample Repairs', exact: true })).toBeVisible()
    if (mobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Receptionist', exact: true })).toHaveAttribute('aria-current', 'page'); expect(unexpected).toEqual([])
  })
}
