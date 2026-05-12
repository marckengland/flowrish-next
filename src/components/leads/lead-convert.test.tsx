import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LeadConvert } from './lead-convert'

const convertLeadMock = vi.fn<(id: string) => Promise<unknown>>()

vi.mock('@/server/actions/leads', () => ({
  convertLead: (id: string) => convertLeadMock(id),
}))

const refreshMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}))

/**
 * Tests for the lead-to-contact conversion control.
 *
 * Validates: Requirements 29.1, 29.2, 29.5
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

describe('LeadConvert', () => {
  beforeEach(() => {
    convertLeadMock.mockReset()
    refreshMock.mockReset()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows the convert button by default', () => {
    const { container, unmount } = mount(
      <LeadConvert leadId="lead-1" alreadyConverted={false} />,
    )
    const button = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Convert to contact'),
    )
    expect(button).toBeDefined()
    unmount()
  })

  it('renders a "already converted" message when the lead is closed', () => {
    const { container, unmount } = mount(
      <LeadConvert leadId="lead-1" alreadyConverted={true} />,
    )
    expect(container.textContent).toContain('already been converted')
    const button = container.querySelector('button')
    expect(button).toBeNull()
    unmount()
  })

  it('opens the confirmation dialog when the convert button is clicked', () => {
    const { container, unmount } = mount(
      <LeadConvert leadId="lead-1" alreadyConverted={false} />,
    )

    const openButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Convert to contact'),
    ) as HTMLButtonElement | undefined
    expect(openButton).toBeDefined()
    act(() => {
      openButton?.click()
    })

    const dialog = container.querySelector('[role="alertdialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('Convert this lead into a contact?')
    unmount()
  })

  it('invokes convertLead and refreshes the router on confirmation', async () => {
    convertLeadMock.mockResolvedValueOnce({
      data: { lead: { id: 'lead-1' }, contact: { id: 'contact-9' } },
    })

    const { container, unmount } = mount(
      <LeadConvert leadId="lead-1" alreadyConverted={false} />,
    )

    // Open the confirmation dialog.
    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('Convert to contact'))
        ?.click()
    })

    // Confirm.
    const confirm = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Convert lead'),
    ) as HTMLButtonElement | undefined
    expect(confirm).toBeDefined()
    await act(async () => {
      confirm?.click()
    })

    // Flush the useTransition microtask queue.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }

    expect(convertLeadMock).toHaveBeenCalledWith('lead-1')
    expect(refreshMock).toHaveBeenCalled()
    unmount()
  })

  it('surfaces the error message returned by the server action', async () => {
    convertLeadMock.mockResolvedValueOnce({
      error: 'No "Closed Won" stage exists in this pipeline.',
    })

    const { container, unmount } = mount(
      <LeadConvert leadId="lead-1" alreadyConverted={false} />,
    )

    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('Convert to contact'))
        ?.click()
    })

    const confirm = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Convert lead'),
    ) as HTMLButtonElement | undefined
    await act(async () => {
      confirm?.click()
    })

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('Closed Won')
    expect(refreshMock).not.toHaveBeenCalled()
    unmount()
  })
})
