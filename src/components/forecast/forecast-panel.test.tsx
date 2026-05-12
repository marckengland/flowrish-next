import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ForecastPanel } from './forecast-panel'

/**
 * Component-level tests for the forecast-page headline panel.
 *
 * Validates: Requirements 10.1, 10.5
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

describe('ForecastPanel', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the three required pipeline metric cards', () => {
    const { container, unmount } = mount(
      <ForecastPanel
        totalPipeline={100_000}
        weightedPipeline={45_000}
        aiPredicted={42_000}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Total pipeline')
    expect(text).toContain('Weighted pipeline')
    expect(text).toContain('AI predicted')
    unmount()
  })

  it('omits the win rate card when winRate is not provided', () => {
    const { container, unmount } = mount(
      <ForecastPanel
        totalPipeline={0}
        weightedPipeline={0}
        aiPredicted={0}
      />,
    )
    expect(container.textContent ?? '').not.toContain('Win rate')
    unmount()
  })

  it('renders the win rate card when provided', () => {
    const { container, unmount } = mount(
      <ForecastPanel
        totalPipeline={0}
        weightedPipeline={0}
        aiPredicted={0}
        winRate={42.5}
      />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Win rate (90d)')
    expect(text).toContain('42.5%')
    unmount()
  })

  it('formats values as whole-dollar currency', () => {
    const { container, unmount } = mount(
      <ForecastPanel
        totalPipeline={1234}
        weightedPipeline={0}
        aiPredicted={0}
      />,
    )
    // Intl currency output depends on the locale but will include "$1,234"
    expect(container.textContent ?? '').toContain('$1,234')
    unmount()
  })
})
