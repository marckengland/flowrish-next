import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LeadDetail } from './lead-detail'
import type { LeadFormStage, LeadFormValues } from './lead-form'

// Stub out the Server Actions that `LeadForm` ultimately imports so the
// edit-mode test path doesn't try to pull in next/cache.
vi.mock('@/server/actions/leads', () => ({
  createLead: vi.fn(async () => ({ data: { id: 'new' } })),
  updateLead: vi.fn(async () => ({ data: { id: 'edited' } })),
}))

/**
 * Component-level tests for the lead detail panel. Covers the read-only
 * default view and the edit-mode toggle that swaps in `LeadForm`.
 *
 * Validates: Requirements 4.1, 4.2, 29.1
 */

const STAGES: LeadFormStage[] = [
  { id: 'stage-new', name: 'New', order: 1 },
  { id: 'stage-qualified', name: 'Qualified', order: 2 },
  { id: 'stage-won', name: 'Closed Won', order: 5 },
]

const BASE_LEAD: LeadFormValues & {
  stage?: { id: string; name: string }
  assignedUser?: { id: string; name: string; email: string } | null
  companyName?: string | null
  lastActivityAt?: string | null
} = {
  id: 'lead-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  stageId: 'stage-qualified',
  email: 'ada@example.com',
  phone: '+1 555 123 4567',
  title: 'Chief Analyst',
  dealValue: 15000,
  currency: 'USD',
  score: 82,
  leadStatus: 'QUALIFIED',
  tier: 'TIER_1',
  linkedinUrl: 'https://linkedin.com/in/ada',
  country: 'UK',
  state: 'London',
  companyName: 'Analytical Engines Ltd',
  description: 'Interested in enterprise plan',
  stage: { id: 'stage-qualified', name: 'Qualified' },
  assignedUser: { id: 'user-1', name: 'Grace Hopper', email: 'grace@example.com' },
  lastActivityAt: new Date().toISOString(),
}

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

describe('LeadDetail', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the lead name, title, and company header', () => {
    const { container, unmount } = mount(
      <LeadDetail lead={BASE_LEAD} stages={STAGES} canEdit={true} />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Ada Lovelace')
    expect(text).toContain('Chief Analyst')
    expect(text).toContain('Analytical Engines Ltd')
    unmount()
  })

  it('shows key field values in the description list', () => {
    const { container, unmount } = mount(
      <LeadDetail lead={BASE_LEAD} stages={STAGES} canEdit={true} />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('ada@example.com')
    expect(text).toContain('+1 555 123 4567')
    expect(text).toContain('Qualified')
    expect(text).toContain('Grace Hopper')
    // Currency-formatted deal value should appear in the panel.
    expect(text).toMatch(/\$15,000/)
    unmount()
  })

  it('hides the Edit button when canEdit is false', () => {
    const { container, unmount } = mount(
      <LeadDetail lead={BASE_LEAD} stages={STAGES} canEdit={false} />,
    )
    const editButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Edit',
    )
    expect(editButton).toBeUndefined()
    unmount()
  })

  it('toggles to edit mode when the Edit button is clicked', () => {
    const { container, unmount } = mount(
      <LeadDetail lead={BASE_LEAD} stages={STAGES} canEdit={true} />,
    )
    const editButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Edit',
    )
    expect(editButton).toBeDefined()

    act(() => {
      editButton?.click()
    })

    // Edit mode exposes the lead form with the hidden `id` field populated.
    const hiddenId = container.querySelector(
      'input[name="id"]',
    ) as HTMLInputElement | null
    expect(hiddenId?.value).toBe('lead-1')
    unmount()
  })

  it('renders an em-dash placeholder for missing optional fields', () => {
    const partial = {
      ...BASE_LEAD,
      phone: null,
      country: null,
      linkedinUrl: null,
    }
    const { container, unmount } = mount(
      <LeadDetail lead={partial} stages={STAGES} canEdit={true} />,
    )
    // The description list dashes should appear for the nulled-out fields.
    const dashes = Array.from(container.querySelectorAll('dd')).filter((dd) =>
      dd.textContent?.includes('—'),
    )
    expect(dashes.length).toBeGreaterThanOrEqual(3)
    unmount()
  })
})
