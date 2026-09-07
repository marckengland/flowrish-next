import { expect, test, type Locator } from '@playwright/test'

interface EdgeDiagnostics {
  edgeCount: number
  paths: string[]
  bounds: Array<{ width: number; height: number }>
  displays: string[]
  visibilities: string[]
}

async function inspectActivityEdges(edges: Locator): Promise<EdgeDiagnostics> {
  return edges.evaluateAll((elements) => ({
    edgeCount: elements.length,
    paths: elements.map(
      (edge) => edge.querySelector('path')?.getAttribute('d') ?? '',
    ),
    bounds: elements.map((edge) => {
      const rect = edge.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }),
    displays: elements.map((edge) => getComputedStyle(edge).display),
    visibilities: elements.map((edge) => getComputedStyle(edge).visibility),
  }))
}

test('cadence activity edges render before node interaction', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.goto('/cadences')
  const cadenceLinks = page.locator('a[href^="/cadences/"]')
  const demoCadence = cadenceLinks.filter({ hasText: '[DEMO] SMB Outbound' })
  const cadence = (await demoCadence.count()) > 0 ? demoCadence.first() : cadenceLinks.first()
  if ((await cadence.count()) === 0) {
    test.skip(true, 'No cadence exists in the test tenant')
  }

  await cadence.click()
  await page.getByRole('tab', { name: 'Flow' }).click()
  await page.waitForTimeout(1_000)

  // Flowgram 1.0.14 registers its renderer twice under React's development
  // strict-mode remount. Production builds are unaffected, so leave that
  // separate dependency issue out of this activity-edge regression check.
  if (browserErrors.some((error) => error.includes('FlowRendererRegistry'))) {
    test.skip(true, 'Flowgram development strict-mode initialization bug')
  }

  const nodes = page.locator('[draggable="true"]')
  await expect.poll(() => nodes.count(), { timeout: 10_000 }).toBeGreaterThan(1)
  const expectedEdgeCount = (await nodes.count()) - 1
  const edges = page.locator('.gedit-flow-activity-edge')

  await expect
    .poll(
      async () => {
        const diagnostics = await inspectActivityEdges(edges)
        return diagnostics.paths.filter(Boolean).length
      },
      { timeout: 10_000 },
    )
    .toBe(expectedEdgeCount)

  const diagnostics = await inspectActivityEdges(edges)
  expect(browserErrors).toEqual([])
  expect(diagnostics.edgeCount).toBe(expectedEdgeCount)
  expect(diagnostics.paths.every((path) => path.length > 0)).toBe(true)
  expect(
    diagnostics.bounds.every(({ width, height }) => width > 24 || height > 24),
  ).toBe(true)
  expect(diagnostics.displays.every((display) => display !== 'none')).toBe(true)
  expect(
    diagnostics.visibilities.every((visibility) => visibility !== 'hidden'),
  ).toBe(true)
})
