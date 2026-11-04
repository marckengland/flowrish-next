import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { TaskForm } from './task-form'

vi.mock('@/server/actions/tasks', () => ({
  createTask: async () => ({ error: 'Review the fields.', fieldErrors: { title: 'Choose a clearer title.', dueDate: 'Choose another time.', leadId: 'Choose an accessible lead.', assigneeId: 'Choose an available assignee.' } }),
  updateTask: vi.fn(),
}))
it('associates every returned task validation message with its labeled control', async () => {
  const { container } = render(<QueryClientProvider client={new QueryClient()}><TaskForm leads={[{ id: 'lead', firstName: 'Practice', lastName: 'Prospect' }]} assignees={[{ id: 'owner', name: 'Practice Owner', email: 'owner@example.test' }]} /></QueryClientProvider>)
  fireEvent.submit(container.querySelector('form')!)
  const title = screen.getByRole('textbox', { name: /Title/ })
  await waitFor(() => expect(title).toHaveAttribute('aria-invalid', 'true'))
  expect(title).toHaveAccessibleDescription('Choose a clearer title.')
  expect(screen.getByLabelText(/Due date/)).toHaveAccessibleDescription('Choose another time.')
  expect(screen.getByRole('combobox', { name: /Lead/ })).toHaveAccessibleDescription('Choose an accessible lead.')
  expect(screen.getByRole('combobox', { name: /Assignee/ })).toHaveAccessibleDescription('Choose an available assignee.')
})
