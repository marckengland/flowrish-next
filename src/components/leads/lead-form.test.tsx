import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LeadForm, type LeadFormStage, type LeadFormValues } from './lead-form'

// Mock the Server Actions so the form submission path is exercised without
// pulling in next/cache, Prisma, or Supabase during a component test.
const createLeadMock = vi.fn<(fd: FormData) => Promise<unknown>>()
const updateLeadMock = vi.fn<(fd: FormData) => Promise<unknown>>()

vi.mock('@/server/actions/leads', () => ({
  createLead: (fd: FormData) => createLeadMock(fd),
  updateLead: (fd: FormData) => updateLeadMock(fd),
}))

const STAGES: LeadFormStage[] = [
  { id: 'stage-new', name: 'New', order: 1 },
  { id: 'stage-qualified', name: 'Qualified', order: 2 },
  { id: 'stage-won', name: 'Closed Won', order: 5 },
]

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

/** Helper: find an input/select by `name` attribute. */
function fieldByName<T extends HTMLInputElement | HTMLSelectElement>(
  container: HTMLElement,
  name: string,
): T {
  const el = container.querySelector(`[name="${name}"]`) as T | null
  if (!el) throw new Error(`Field [name="${name}"] not found`)
  return el
}

describe('LeadForm', () => {
  beforeEach(() => {
    createLeadMock.mockReset()
    updateLeadMock.mockReset()
  })

  afterEach(() => {
    // Ensure each test cleans up any lingering DOM nodes.
    document.body.innerHTML = ''
  })

  it('renders all required fields for creating a lead', () => {
    const { container, unmount } = mount(<LeadForm stages={STAGES} />)

    expect(fieldByName(container, 'firstName').tagName).toBe('INPUT')
    expect(fieldByName(container, 'lastName').tagName).toBe('INPUT')
    expect(fieldByName(container, 'stageId').tagName).toBe('SELECT')
    expect(fieldByName(container, 'email').tagName).toBe('INPUT')
    expect(fieldByName(container, 'dealValue').tagName).toBe('INPUT')
    expect(fieldByName(container, 'score').tagName).toBe('INPUT')

    // No hidden id field in create mode.
    expect(container.querySelector('input[name="id"]')).toBeNull()

    // Submit button defaults to "Create Lead".
    const submit = container.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement | null
    expect(submit?.textContent).toContain('Create Lead')
    unmount()
  })

  it('marks firstName, lastName, and stageId as required', () => {
    const { container, unmount } = mount(<LeadForm stages={STAGES} />)

    expect(fieldByName<HTMLInputElement>(container, 'firstName').required).toBe(
      true,
    )
    expect(fieldByName<HTMLInputElement>(container, 'lastName').required).toBe(
      true,
    )
    expect(fieldByName<HTMLSelectElement>(container, 'stageId').required).toBe(
      true,
    )
    // Email is optional at the DOM level — server-side Zod still validates.
    expect(fieldByName<HTMLInputElement>(container, 'email').required).toBe(
      false,
    )
    unmount()
  })

  it('renders stages sorted by `order` and defaults to the first stage', () => {
    // Pass in reversed order to verify the form sorts them.
    const reversed = [...STAGES].reverse()
    const { container, unmount } = mount(<LeadForm stages={reversed} />)

    const stageSelect = fieldByName<HTMLSelectElement>(container, 'stageId')
    const optionValues = Array.from(stageSelect.options).map((o) => o.value)
    expect(optionValues).toEqual(['stage-new', 'stage-qualified', 'stage-won'])
    expect(stageSelect.value).toBe('stage-new')
    unmount()
  })

  it('populates fields and hidden id when editing an existing lead', () => {
    const lead: LeadFormValues = {
      id: 'lead-123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      stageId: 'stage-qualified',
      email: 'ada@example.com',
      phone: '+1 555 123 4567',
      title: 'Chief Analyst',
      dealValue: 12500.5,
      currency: 'USD',
      score: 82,
      leadStatus: 'QUALIFIED',
      tier: 'TIER_1',
      companyName: 'Analytical Engines Ltd',
      description: 'Interested in enterprise plan',
    }

    const { container, unmount } = mount(
      <LeadForm stages={STAGES} lead={lead} />,
    )

    const hiddenId = container.querySelector(
      'input[name="id"]',
    ) as HTMLInputElement | null
    expect(hiddenId?.value).toBe('lead-123')

    expect(fieldByName<HTMLInputElement>(container, 'firstName').value).toBe(
      'Ada',
    )
    expect(fieldByName<HTMLInputElement>(container, 'lastName').value).toBe(
      'Lovelace',
    )
    expect(fieldByName<HTMLSelectElement>(container, 'stageId').value).toBe(
      'stage-qualified',
    )
    expect(fieldByName<HTMLSelectElement>(container, 'leadStatus').value).toBe(
      'QUALIFIED',
    )
    expect(fieldByName<HTMLSelectElement>(container, 'tier').value).toBe(
      'TIER_1',
    )
    expect(fieldByName<HTMLInputElement>(container, 'dealValue').value).toBe(
      '12500.5',
    )
    expect(fieldByName<HTMLInputElement>(container, 'score').value).toBe('82')
    expect(fieldByName<HTMLInputElement>(container, 'currency').value).toBe(
      'USD',
    )
    expect(fieldByName<HTMLInputElement>(container, 'companyName').value).toBe(
      'Analytical Engines Ltd',
    )

    const description = container.querySelector(
      'textarea[name="description"]',
    ) as HTMLTextAreaElement | null
    expect(description?.value).toBe('Interested in enterprise plan')

    const submit = container.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement | null
    expect(submit?.textContent).toContain('Save Changes')
    unmount()
  })

  it('invokes createLead on submit in create mode', async () => {
    createLeadMock.mockResolvedValueOnce({ data: { id: 'new-lead' } })

    const onSuccess = vi.fn()
    const { container, unmount } = mount(
      <LeadForm stages={STAGES} onSuccess={onSuccess} />,
    )

    fieldByName<HTMLInputElement>(container, 'firstName').value = 'Grace'
    fieldByName<HTMLInputElement>(container, 'lastName').value = 'Hopper'
    // stageId already defaults to first stage.

    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      form.requestSubmit()
    })

    expect(createLeadMock).toHaveBeenCalledTimes(1)
    expect(updateLeadMock).not.toHaveBeenCalled()

    const submittedFormData = createLeadMock.mock.calls[0]![0]
    expect(submittedFormData.get('firstName')).toBe('Grace')
    expect(submittedFormData.get('lastName')).toBe('Hopper')
    expect(submittedFormData.get('stageId')).toBe('stage-new')
    expect(submittedFormData.get('leadStatus')).toBe('NEW')
    // `id` is only present in edit mode.
    expect(submittedFormData.get('id')).toBeNull()

    expect(onSuccess).toHaveBeenCalledWith('new-lead')
    unmount()
  })

  it('invokes updateLead with the lead id in edit mode', async () => {
    updateLeadMock.mockResolvedValueOnce({ data: { id: 'lead-xyz' } })

    const onSuccess = vi.fn()
    const lead: LeadFormValues = {
      id: 'lead-xyz',
      firstName: 'Alan',
      lastName: 'Turing',
      stageId: 'stage-qualified',
    }
    const { container, unmount } = mount(
      <LeadForm stages={STAGES} lead={lead} onSuccess={onSuccess} />,
    )

    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      form.requestSubmit()
    })

    expect(updateLeadMock).toHaveBeenCalledTimes(1)
    expect(createLeadMock).not.toHaveBeenCalled()

    const submittedFormData = updateLeadMock.mock.calls[0]![0]
    expect(submittedFormData.get('id')).toBe('lead-xyz')
    expect(submittedFormData.get('firstName')).toBe('Alan')
    expect(submittedFormData.get('stageId')).toBe('stage-qualified')

    expect(onSuccess).toHaveBeenCalledWith('lead-xyz')
    unmount()
  })

  it('surfaces validation errors returned by the server action', async () => {
    createLeadMock.mockResolvedValueOnce({ error: 'First name is required' })

    const { container, unmount } = mount(<LeadForm stages={STAGES} />)

    // Satisfy the browser's native `required` validation so the submit
    // reaches the Server Action, which is what we're exercising here.
    fieldByName<HTMLInputElement>(container, 'firstName').value = 'Grace'
    fieldByName<HTMLInputElement>(container, 'lastName').value = 'Hopper'

    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      form.requestSubmit()
    })

    // `useActionState` updates state asynchronously after the action
    // resolves. Flush the microtask queue a few times so the error message
    // is rendered before we assert.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }

    expect(createLeadMock).toHaveBeenCalledTimes(1)
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe('First name is required')
    unmount()
  })

  it('renders a Cancel button only when an onCancel handler is provided', () => {
    const onCancel = vi.fn()
    const { container, unmount } = mount(
      <LeadForm stages={STAGES} onCancel={onCancel} />,
    )

    const cancel = Array.from(
      container.querySelectorAll('button'),
    ).find((b) => b.textContent?.includes('Cancel'))
    expect(cancel).toBeDefined()

    act(() => {
      cancel?.click()
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
    unmount()

    const { container: container2, unmount: unmount2 } = mount(
      <LeadForm stages={STAGES} />,
    )
    const noCancel = Array.from(
      container2.querySelectorAll('button'),
    ).find((b) => b.textContent?.includes('Cancel'))
    expect(noCancel).toBeUndefined()
    unmount2()
  })
})
