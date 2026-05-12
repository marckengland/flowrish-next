import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { RiskIndicator } from './risk-indicator'

/**
 * Component-level tests for the forecast risk indicator badge.
 *
 * Validates: Requirement 10.3
 */

function mount(ui: React.JSX.Element): {
  container: HTMLDivElement
  unmount: () => void
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe('RiskIndicator', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders an accessible status role with the risk label', () => {
    const { container, unmount } = mount(<RiskIndicator risk="On Track" />)
    const status = container.querySelector('[role="status"]')
    expect(status).not.toBeNull()
    expect(status?.getAttribute('aria-label')).toBe('Forecast risk: On Track')
    expect(status?.textContent).toContain('Risk: On Track')
    unmount()
  })

  it.each(['On Track', 'At Risk', 'High Risk'] as const)(
    'renders the %s classification',
    (risk) => {
      const { container, unmount } = mount(<RiskIndicator risk={risk} />)
      expect(container.textContent ?? '').toContain(`Risk: ${risk}`)
      unmount()
    },
  )

  it('includes the optional context label when provided', () => {
    const { container, unmount } = mount(
      <RiskIndicator risk="At Risk" context="2026-05" />,
    )
    expect(container.textContent ?? '').toContain('2026-05')
    unmount()
  })
})
