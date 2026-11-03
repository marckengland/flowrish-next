import { expect, test } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

for (const width of [1280, 375]) {
  test(`public address and contact links at ${width}px without AI or widget requests`, async ({
    page,
  }) => {
    const forbidden: string[] = []
    await page.route('**/*', (route) => {
      const request = route.request(),
        url = new URL(request.url())
      if (
        request.method() !== 'GET' ||
        /deepseek|twilio|openai|anthropic/i.test(url.hostname) ||
        /website-receptionist|widget\.js/.test(url.pathname)
      ) {
        forbidden.push(`${request.method()} ${url.pathname}`)
        return route.abort()
      }
      return route.continue()
    })
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'Sell more. Admin less.' }),
    ).toBeVisible()
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /^https:\/\/flowrish\.marckengland\.com\/?$/,
    )
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      'content',
      /^https:\/\/flowrish\.marckengland\.com\/?$/,
    )
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0)
    await expect(
      page.getByRole('link', { name: /Book a demo|Talk to sales/ }),
    ).toHaveCount(0)
    expect(await page.locator('body').innerText()).not.toMatch(
      /(?:app\.)?flowrish\.com/,
    )
    await expect(
      page.getByText('flowrish.marckengland.com', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: /Get started|Join the waitlist/ }).first(),
    ).toHaveAttribute('href', /^(\/onboarding|#waitlist)$/)
    const entities = JSON.parse(
      (await page
        .locator('script[type="application/ld+json"]')
        .textContent()) ?? '{}',
    )['@graph']
    expect(entities).toHaveLength(3)
    expect(
      entities.every(
        (entity: { url: string }) =>
          entity.url === 'https://flowrish.marckengland.com/',
      ),
    ).toBe(true)
    await page.getByRole('button', { name: 'Monthly', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Monthly', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: /Annual/ }).click()
    await expect(page.getByRole('button', { name: /Annual/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await expect(
      page.locator('iframe[src*="widget"], script[src*="widget.js"]'),
    ).toHaveCount(0)
    expect(forbidden).toEqual([])
  })
}

test('robots and sitemap advertise the same public address', async ({
  request,
}) => {
  const robots = await request.get('/robots.txt'),
    sitemap = await request.get('/sitemap.xml')
  expect(robots.ok()).toBe(true)
  expect(sitemap.ok()).toBe(true)
  expect(await robots.text()).toContain(
    'Sitemap: https://flowrish.marckengland.com/sitemap.xml',
  )
  expect(await sitemap.text()).toContain(
    '<loc>https://flowrish.marckengland.com/</loc>',
  )
  expect(`${await robots.text()}${await sitemap.text()}`).not.toContain(
    'https://flowrish.com',
  )
})
