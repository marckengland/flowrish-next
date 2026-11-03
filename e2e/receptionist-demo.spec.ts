import { expect, test } from '@playwright/test'

for (const mobile of [false, true]) {
  test(`practices receptionist conversation, corrected callback, CRM approval and outcomes on ${mobile ? 'mobile' : 'desktop'} without live requests`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    const unexpected: string[] = [], demoApiRequests: string[] = []
    let interacting = false
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (/\/(?:api\/(?:ai|voice|calling|public\/website-receptionist|admin\/ai-provider)|receptionist-widget(?:-frame)?\.js)(?:\/|$)/.test(url.pathname) || /(^|\.)(?:deepseek\.com|openai\.com|anthropic\.com|googleapis\.com|openrouter\.ai|tokenrouter\.com|twilio\.com)$/.test(url.hostname) || (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method()))) {
        unexpected.push(`${request.method()} ${url.pathname}`); await route.fulfill({ status: 503, json: {} }); return
      }
      if (interacting && url.pathname.startsWith('/api/')) demoApiRequests.push(`${request.method()} ${url.pathname}`)
      await route.continue()
    })
    await page.goto('/receptionist')
    await page.getByRole('link', { name: 'Demo mode', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Demo mode', exact: true })).toBeVisible()
    await expect(page.getByText('Prewritten replies. No live AI.', { exact: true })).toBeVisible()
    interacting = true
    const storageBefore = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))
    const log = page.getByRole('log', { name: 'Demo conversation', exact: true })
    await page.getByRole('button', { name: 'Ask about services', exact: true }).click(); await expect(log).toContainText(/Approved services excerpt|team will confirm the available services/)
    await page.getByRole('button', { name: 'Ask about hours', exact: true }).click(); await expect(log).toContainText(/Staffed callback hours|team will confirm callback hours/)
    await expect(page.getByRole('textbox', { name: 'Sample phone', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Ask about pricing', exact: true }).click(); await expect(log).toContainText(/Approved pricing excerpt|team will confirm pricing/)
    for (let attempt = 0; attempt < 8; attempt++) await page.getByRole('button', { name: 'Ask about pricing', exact: true }).click()
    await expect.poll(() => log.evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2)).toBe(true)
    const message = page.getByRole('textbox', { name: 'Sample visitor message', exact: true })
    await message.fill('<img src=x onerror=alert(1)> Can you guarantee tomorrow?'); await message.press('Enter'); await expect(log).toContainText('cannot answer that'); await expect(log.locator('img')).toHaveCount(0)
    await page.getByRole('button', { name: 'Practice a callback', exact: true }).click()
    await page.getByRole('button', { name: 'Review simulated callback', exact: true }).click()
    const consent = page.getByRole('checkbox', { name: 'I confirm these fictional callback details.', exact: true })
    await expect(page.getByRole('button', { name: 'Confirm simulated callback', exact: true })).toBeDisabled(); await consent.check()
    await page.getByRole('textbox', { name: 'Sample phone', exact: true }).fill('+12025550124'); await expect(consent).toHaveCount(0)
    await page.getByRole('button', { name: 'Review simulated callback', exact: true }).click(); await expect(consent).not.toBeChecked(); await consent.check()
    await page.getByRole('button', { name: 'Confirm simulated callback', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
    await page.getByRole('button', { name: 'Preview simulated CRM handoff', exact: true }).click()
    const create = page.getByRole('button', { name: 'Create simulated CRM handoff', exact: true }); await expect(create).toBeDisabled()
    await page.getByRole('checkbox', { name: 'I approve this simulated lead and task.', exact: true }).check(); await create.click()
    const receipt = page.getByRole('region', { name: 'Simulated CRM receipt', exact: true })
    await expect(receipt).toContainText('+12025550124'); await expect(receipt).toContainText('Open'); await expect(receipt.getByRole('link')).toHaveCount(0)
    for (const outcome of ['no_answer', 'retry', 'reached']) {
      await page.getByRole('combobox', { name: 'Simulated callback outcome', exact: true }).selectOption(outcome)
      await page.getByRole('button', { name: 'Preview simulated outcome', exact: true }).click()
      const record = page.getByRole('button', { name: 'Record simulated outcome', exact: true }); await expect(record).toBeDisabled()
      await page.getByRole('checkbox', { name: 'I confirm this simulated outcome.', exact: true }).check(); await record.click()
      await expect(receipt).toContainText(outcome === 'reached' ? 'Closed' : 'Open')
    }
    await expect(page.getByRole('region', { name: 'Simulated outcome history', exact: true }).getByRole('listitem')).toHaveCount(3)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await receipt.scrollIntoViewIfNeeded(); await page.screenshot({ path: `/tmp/flowrish-demo-${mobile ? 'mobile' : 'desktop'}.png` })
    await page.getByRole('button', { name: 'Restart demo', exact: true }).click(); await expect(message).toBeFocused(); await expect(receipt).toHaveCount(0); await expect(log.getByRole('listitem')).toHaveCount(1)
    expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual(storageBefore)
    expect(unexpected).toEqual([]); expect(demoApiRequests).toEqual([])
  })
}
