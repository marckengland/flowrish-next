import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  TaskForm,
  toDateTimeLocal,
  type TaskFormAssigneeOption,
  type TaskFormLeadOption,
  type TaskFormValues,
} from './task-form'

/**
 * Unit tests for the task form — covers field rendering, create/edit
 * mode switching, Server Action invocation, and validation error
 * surfacing. Matches the style used by `lead-form.test.tsx`.
 *
 * Validates: Requirements 18.1, 18.2, 18.4
 */

const createTaskMock = vi.fn<(fd: FormData) => Promise<unknown>>()
const updateTaskMock = vi.fn<(fd: FormData) => Promise<unknown>>()

vi.mock('@/server/actions/tasks', () => ({
  createTask: (fd: FormData) => createTaskMock(fd),
  updateTask: (fd: FormData) => updateTaskMock(fd),
}))

const LEADS: TaskFormLeadOption[] = [
  { id: 'lead-1', firstName: 'Ada', lastName: 'Lovelace', companyName: 'Analytical Engines' },
  { id: 'lead-2', firstName: 'Grace', lastName: 'Hopper', companyName: null },
]

const ASSIGNEES: TaskFormAssigneeOption[] = [
  { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
  { id: 'user-2', name: 'Bob', email: 'bob@example.com' },
]

function mount(ui: React.JSX.Element): {
  container: HTMLDivElement
  unmount: () => void
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  // TaskForm calls useQueryClient (to invalidate the tasks list after a
  // successful mutation), so it must render under a provider.
  const queryClient = new QueryClient()
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    )
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

function fieldByName<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
  container: HTMLElement,
  name: string,
): T {
  const el = container.querySelector(`[name="${name}"]`) as T | null
  if (!el) throw new Error(`Field [name="${name}"] not found`)
  return el
}

describe('toDateTimeLocal', () => {
  it('returns an empty string for null/undefined/empty input', () => {
    expect(toDateTimeLocal(null)).toBe('')
    expect(toDateTimeLocal(undefined)).toBe('')
    expect(toDateTimeLocal('')).toBe('')
  })

  it('formats a Date as YYYY-MM-DDTHH:mm in local time', () => {
    // Construct a date via local-time constructor so the test is
    // timezone-agnostic.
    const d = new Date(2024, 5 /* June */, 15, 9, 30)
    expect(toDateTimeLocal(d)).toBe('2024-06-15T09:30')
  })

  it('returns an empty string for unparseable strings', () => {
    expect(toDateTimeLocal('not-a-date')).toBe('')
  })
})

describe('TaskForm', () => {
  beforeEach(() => {
    createTaskMock.mockReset()
    updateTaskMock.mockReset()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders all required fields in create mode', () => {
    const { container, unmount } = mount(
      <TaskForm leads={LEADS} assignees={ASSIGNEES} />,
    )

    expect(fieldByName(container, 'title').tagName).toBe('INPUT')
    expect(fieldByName(container, 'description').tagName).toBe('TEXTAREA')
    expect(fieldByName(container, 'dueDate').tagName).toBe('INPUT')
    const priority = container.querySelector('[role="radiogroup"][aria-label="Priority"]')
    expect(priority).not.toBeNull()
    expect(Array.from(priority!.querySelectorAll('[role="radio"]')).map((option) => option.textContent)).toEqual(['Low', 'Medium', 'High'])
    expect(priority!.querySelector('[aria-checked="true"]')?.textContent).toBe('Medium')
    expect(fieldByName<HTMLInputElement>(container, 'priority').value).toBe('MEDIUM')
    expect(fieldByName(container, 'leadId').tagName).toBe('SELECT')
    expect(fieldByName(container, 'assigneeId').tagName).toBe('SELECT')

    // No hidden id field in create mode.
    expect(container.querySelector('input[name="id"]')).toBeNull()

    // Submit button defaults to "Create Task".
    const submit = container.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement | null
    expect(submit?.textContent).toContain('Create Task')
    unmount()
  })

  it('marks title, dueDate, leadId, and assigneeId as required', () => {
    const { container, unmount } = mount(
      <TaskForm leads={LEADS} assignees={ASSIGNEES} />,
    )
    expect(fieldByName<HTMLInputElement>(container, 'title').required).toBe(
      true,
    )
    expect(fieldByName<HTMLInputElement>(container, 'dueDate').required).toBe(
      true,
    )
    expect(fieldByName<HTMLSelectElement>(container, 'leadId').required).toBe(
      true,
    )
    expect(
      fieldByName<HTMLSelectElement>(container, 'assigneeId').required,
    ).toBe(true)
    // Description is optional at the DOM level — server-side Zod still
    // validates.
    expect(
      fieldByName<HTMLTextAreaElement>(container, 'description').required,
    ).toBe(false)
    unmount()
  })

  it('defaults priority to MEDIUM and preselects first lead and first assignee', () => {
    const { container, unmount } = mount(
      <TaskForm leads={LEADS} assignees={ASSIGNEES} />,
    )
    expect(fieldByName<HTMLSelectElement>(container, 'priority').value).toBe(
      'MEDIUM',
    )
    expect(fieldByName<HTMLSelectElement>(container, 'leadId').value).toBe(
      'lead-1',
    )
    expect(fieldByName<HTMLSelectElement>(container, 'assigneeId').value).toBe(
      'user-1',
    )
    unmount()
  })

  it('honors defaultLeadId and defaultAssigneeId when provided', () => {
    const { container, unmount } = mount(
      <TaskForm
        leads={LEADS}
        assignees={ASSIGNEES}
        defaultLeadId="lead-2"
        defaultAssigneeId="user-2"
      />,
    )
    expect(fieldByName<HTMLSelectElement>(container, 'leadId').value).toBe(
      'lead-2',
    )
    expect(fieldByName<HTMLSelectElement>(container, 'assigneeId').value).toBe(
      'user-2',
    )
    unmount()
  })

  it('populates fields and hidden id when editing an existing task', () => {
    const task: TaskFormValues = {
      id: 'task-xyz',
      title: 'Follow up on proposal',
      description: 'Call about pricing',
      priority: 'HIGH',
      dueDate: new Date(2024, 5, 15, 9, 30),
      leadId: 'lead-2',
      assigneeId: 'user-2',
    }
    const { container, unmount } = mount(
      <TaskForm leads={LEADS} assignees={ASSIGNEES} task={task} />,
    )

    const hiddenId = container.querySelector(
      'input[name="id"]',
    ) as HTMLInputElement | null
    expect(hiddenId?.value).toBe('task-xyz')

    expect(fieldByName<HTMLInputElement>(container, 'title').value).toBe(
      'Follow up on proposal',
    )
    expect(
      fieldByName<HTMLTextAreaElement>(container, 'description').value,
    ).toBe('Call about pricing')
    expect(fieldByName<HTMLSelectElement>(container, 'priority').value).toBe(
      'HIGH',
    )
    expect(fieldByName<HTMLSelectElement>(container, 'leadId').value).toBe(
      'lead-2',
    )
    expect(fieldByName<HTMLSelectElement>(container, 'assigneeId').value).toBe(
      'user-2',
    )
    expect(fieldByName<HTMLInputElement>(container, 'dueDate').value).toBe(
      '2024-06-15T09:30',
    )

    const submit = container.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement | null
    expect(submit?.textContent).toContain('Save Changes')
    unmount()
  })

  it('invokes createTask on submit in create mode', async () => {
    createTaskMock.mockResolvedValueOnce({ data: { id: 'new-task' } })

    const onSuccess = vi.fn()
    const { container, unmount } = mount(
      <TaskForm
        leads={LEADS}
        assignees={ASSIGNEES}
        onSuccess={onSuccess}
      />,
    )

    fieldByName<HTMLInputElement>(container, 'title').value = 'Call Ada'
    fieldByName<HTMLInputElement>(container, 'dueDate').value =
      '2100-01-15T10:00'

    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      form.requestSubmit()
    })

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }

    expect(createTaskMock).toHaveBeenCalledTimes(1)
    expect(updateTaskMock).not.toHaveBeenCalled()

    const submitted = createTaskMock.mock.calls[0]![0]
    expect(submitted.get('title')).toBe('Call Ada')
    expect(submitted.get('dueDate')).toBe('2100-01-15T10:00')
    expect(submitted.get('priority')).toBe('MEDIUM')
    expect(submitted.get('leadId')).toBe('lead-1')
    expect(submitted.get('assigneeId')).toBe('user-1')
    // `id` is only present in edit mode.
    expect(submitted.get('id')).toBeNull()

    expect(onSuccess).toHaveBeenCalledWith('new-task')
    unmount()
  })

  it('submits the priority selected with the accessible chips', async () => {
    createTaskMock.mockResolvedValueOnce({ data: { id: 'new-task' } })
    const { container, unmount } = mount(<TaskForm leads={LEADS} assignees={ASSIGNEES} />)
    const high = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((button) => button.textContent === 'High')!
    act(() => { high.click() })
    expect(high.getAttribute('aria-checked')).toBe('true')
    expect(fieldByName<HTMLInputElement>(container, 'priority').value).toBe('HIGH')
    fieldByName<HTMLInputElement>(container, 'title').value = 'Call Ada'
    fieldByName<HTMLInputElement>(container, 'dueDate').value = '2100-01-15T10:00'
    await act(async () => { (container.querySelector('form') as HTMLFormElement).requestSubmit() })
    expect(createTaskMock).toHaveBeenCalledTimes(1)
    expect(createTaskMock.mock.calls[0]![0].get('priority')).toBe('HIGH')
    unmount()
  })

  it('invokes updateTask with the task id in edit mode', async () => {
    updateTaskMock.mockResolvedValueOnce({ data: { id: 'task-xyz' } })

    const task: TaskFormValues = {
      id: 'task-xyz',
      title: 'Follow up',
      priority: 'HIGH',
      dueDate: new Date(2024, 5, 15, 9, 30),
      leadId: 'lead-2',
      assigneeId: 'user-2',
    }

    const onSuccess = vi.fn()
    const { container, unmount } = mount(
      <TaskForm
        leads={LEADS}
        assignees={ASSIGNEES}
        task={task}
        onSuccess={onSuccess}
      />,
    )

    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      form.requestSubmit()
    })

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }

    expect(updateTaskMock).toHaveBeenCalledTimes(1)
    expect(createTaskMock).not.toHaveBeenCalled()

    const submitted = updateTaskMock.mock.calls[0]![0]
    expect(submitted.get('id')).toBe('task-xyz')
    expect(submitted.get('title')).toBe('Follow up')
    expect(submitted.get('priority')).toBe('HIGH')
    expect(submitted.get('leadId')).toBe('lead-2')
    expect(submitted.get('assigneeId')).toBe('user-2')

    expect(onSuccess).toHaveBeenCalledWith('task-xyz')
    unmount()
  })

  it('surfaces validation errors returned by the Server Action', async () => {
    createTaskMock.mockResolvedValueOnce({ error: 'Due date is required' })

    const { container, unmount } = mount(
      <TaskForm leads={LEADS} assignees={ASSIGNEES} />,
    )

    fieldByName<HTMLInputElement>(container, 'title').value = 'Call Ada'
    fieldByName<HTMLInputElement>(container, 'dueDate').value =
      '2100-01-15T10:00'

    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      form.requestSubmit()
    })

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve()
      })
    }

    expect(createTaskMock).toHaveBeenCalledTimes(1)
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe('Due date is required')
    unmount()
  })

  it('renders a Cancel button only when an onCancel handler is provided', () => {
    const onCancel = vi.fn()
    const { container, unmount } = mount(
      <TaskForm
        leads={LEADS}
        assignees={ASSIGNEES}
        onCancel={onCancel}
      />,
    )
    const cancel = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Cancel'),
    )
    expect(cancel).toBeDefined()

    act(() => {
      cancel?.click()
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
    unmount()

    const { container: c2, unmount: u2 } = mount(
      <TaskForm leads={LEADS} assignees={ASSIGNEES} />,
    )
    const none = Array.from(c2.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Cancel'),
    )
    expect(none).toBeUndefined()
    u2()
  })
})
