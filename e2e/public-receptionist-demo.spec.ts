import { expect, test } from '@playwright/test'

test.use({
  storageState: { cookies: [], origins: [] },
  serviceWorkers: 'block',
})

for (const mobile of [false, true]) {
  test(`explores the public receptionist sample on ${mobile ? 'mobile' : 'desktop'} without accounts or live requests`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    const unexpected: string[] = []
    const origin = new URL(baseURL!).origin
    await page.route('**/*', async (route) => {
      const request = route.request(),
        url = new URL(request.url())
      if (
        url.origin !== origin ||
        !['GET', 'HEAD'].includes(request.method()) ||
        url.pathname.startsWith('/api/') ||
        /receptionist-widget(?:-frame)?\.js$/.test(url.pathname)
      ) {
        unexpected.push(`${request.method()} ${url.pathname}`)
        await route.fulfill({ status: 503, json: {} })
        return
      }
      await route.continue()
    })
    await page.goto('/demo')
    await expect(page).toHaveURL(/\/demo$/)
    await expect(
      page.getByRole('heading', { name: 'Try the receptionist', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Prewritten replies. No live AI.', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(/fixed sample details for Flowrish/),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Join the waitlist', exact: true }),
    ).toHaveAttribute('href', '/#waitlist')
    await expect(
      page.getByRole('link', { name: 'Back to Flowrish', exact: true }),
    ).toHaveAttribute('href', '/')
    await expect(
      page.getByRole('link', { name: 'Receptionist home', exact: true }),
    ).toHaveCount(0)
    const cookiesBefore = await context.cookies()
    const storageBefore = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }))
    const log = page.getByRole('log', {
      name: 'Demo conversation',
      exact: true,
    })
    await page
      .getByRole('button', { name: 'Ask about services', exact: true })
      .click()
    await expect(log).toContainText('Sample services excerpt')
    await expect(log).toContainText('sales pipelines')
    await page
      .getByRole('button', { name: 'Ask about hours', exact: true })
      .click()
    await expect(log).toContainText('Mon–Fri 9am–5pm, Asia/Manila')
    await page
      .getByRole('button', { name: 'Ask about pricing', exact: true })
      .click()
    await expect(log).toContainText('Our team will confirm pricing')
    await expect(log).not.toContainText('Approved')
    const input = page.getByRole('textbox', {
      name: 'Sample visitor message',
      exact: true,
    })
    await input.fill('<img src=x onerror=alert(1)> Can you guarantee tomorrow?')
    await input.press('Enter')
    await expect(log).toContainText('cannot answer that')
    await expect(log.locator('img')).toHaveCount(0)
    await page
      .getByRole('button', { name: 'Practice a callback', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Review simulated callback', exact: true })
      .click()
    const confirm = page.getByRole('button', {
      name: 'Confirm simulated callback',
      exact: true,
    })
    await expect(confirm).toBeDisabled()
    await page
      .getByRole('checkbox', {
        name: 'I confirm these fictional callback details.',
        exact: true,
      })
      .check()
    await confirm.click()
    await page
      .getByRole('button', {
        name: 'Preview simulated CRM handoff',
        exact: true,
      })
      .click()
    const create = page.getByRole('button', {
      name: 'Create simulated CRM handoff',
      exact: true,
    })
    await expect(create).toBeDisabled()
    await page
      .getByRole('checkbox', {
        name: 'I approve this simulated lead and task.',
        exact: true,
      })
      .check()
    await create.click()
    const receipt = page.getByRole('region', {
      name: 'Simulated CRM receipt',
      exact: true,
    })
    await expect(receipt).toContainText('Jamie Example')
    await expect(receipt).toContainText('Open')
    await expect(receipt.getByRole('link')).toHaveCount(0)
    await page
      .getByRole('combobox', {
        name: 'Simulated callback outcome',
        exact: true,
      })
      .selectOption('reached')
    await page
      .getByRole('button', { name: 'Preview simulated outcome', exact: true })
      .click()
    const record = page.getByRole('button', {
      name: 'Record simulated outcome',
      exact: true,
    })
    await expect(record).toBeDisabled()
    await page
      .getByRole('checkbox', {
        name: 'I confirm this simulated outcome.',
        exact: true,
      })
      .check()
    await record.click()
    await expect(receipt).toContainText('Closed')
    await expect(
      page.locator('iframe, script[src*="receptionist-widget"]'),
    ).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: `/tmp/flowrish-public-demo-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    })
    await page
      .getByRole('button', { name: 'Restart demo', exact: true })
      .click()
    await expect(input).toBeFocused()
    await expect(receipt).toHaveCount(0)
    await expect(log.getByRole('listitem')).toHaveCount(1)
    await page.reload()
    await expect(log.getByRole('listitem')).toHaveCount(1)
    expect(
      await page.evaluate(() => ({
        local: { ...localStorage },
        session: { ...sessionStorage },
      })),
    ).toEqual(storageBefore)
    expect(await context.cookies()).toEqual(cookiesBefore)
    expect(unexpected).toEqual([])
  })
}
