import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceSwitcher } from './workspace-switcher'
const m = vi.hoisted(() => ({ switchTo: vi.fn() }))
vi.mock('./workspace-boundary', () => ({
  useWorkspaceSwitch: () => m.switchTo,
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
it('shows only returned memberships, the current business, and the unsaved-edit notice', async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          workspaces: [
            { id: 'one', name: 'Practice One' },
            { id: 'two', name: 'Practice Two' },
          ],
        },
      }),
    ),
  )
  vi.stubGlobal('fetch', fetch)
  render(
    <WorkspaceSwitcher organizationId="one" organizationName="Practice One" />,
  )
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Business' })).toBeEnabled(),
  )
  expect(screen.getAllByRole('option').map((x) => x.textContent)).toEqual([
    'Practice One',
    'Practice Two',
  ])
  expect(screen.getByRole('combobox')).toHaveValue('one')
  expect(screen.getByText(/unsaved edits/i)).toBeVisible()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'two' } })
  expect(m.switchTo).toHaveBeenCalledExactlyOnceWith('two')
  expect(fetch.mock.calls.every((call) => !call[1]?.method)).toBe(true)
})
it('shows safe load errors and retries reads only when requested', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('sensitive upstream error'))
  vi.stubGlobal('fetch', fetch)
  render(
    <WorkspaceSwitcher organizationId="one" organizationName="Practice One" />,
  )
  expect(
    await screen.findByRole('button', { name: 'Retry businesses' }),
  ).toBeVisible()
  expect(screen.queryByText(/sensitive upstream/)).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(1)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Retry businesses' }))
  })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(m.switchTo).not.toHaveBeenCalled()
})
it('keeps the current business label when its membership disappears and offers explicit recovery', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { workspaces: [{ id: 'two', name: 'Practice Two' }] },
          }),
        ),
      ),
  )
  render(
    <WorkspaceSwitcher organizationId="one" organizationName="Practice One" />,
  )
  await screen.findByRole('option', { name: 'Practice Two' })
  expect(screen.getByRole('combobox', { name: 'Business' })).toHaveValue('one')
  expect(
    screen.getByRole('link', { name: 'Choose another business' }),
  ).toHaveAttribute('href', '/workspaces')
  expect(m.switchTo).not.toHaveBeenCalled()
})
