import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StaffWaitlistInbox } from './staff-waitlist-inbox'
import {
  sampleWaitlistEntry,
  sampleWaitlistOptions,
  sampleWaitlistPreview,
  sampleWaitlistReceipt,
  waitlistIds,
} from './waitlist-fixture.test-data'

const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset().mockImplementation(async (input, init) => {
    const url = String(input)
    let data: unknown = {
      entries: [sampleWaitlistEntry()],
      page: 1,
      hasNext: false,
      canHandoff: true,
    }
    if (url.endsWith('/preview')) data = sampleWaitlistPreview()
    else if (url.endsWith('/handoff'))
      data =
        init?.method === 'POST'
          ? sampleWaitlistReceipt()
          : sampleWaitlistOptions()
    else if (init?.method === 'PATCH')
      data = {
        ...sampleWaitlistEntry(),
        reviewStatus: 'reviewed',
        reviewVersion: 1,
      }
    return { ok: true, status: 200, json: async () => ({ data }) }
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const writes = () =>
  fetchMock.mock.calls.filter(
    ([, init]) => init?.method && init.method !== 'GET',
  )
async function prepare() {
  render(<StaffWaitlistInbox />)
  const open = await screen.findByRole('button', {
    name: 'Prepare CRM handoff for jamie@example.test',
  })
  await waitFor(() => expect(open).toBeEnabled())
  fireEvent.click(open)
  const mode = await screen.findByRole('radio', { name: 'Create a new lead' })
  await waitFor(() => expect(mode).toBeEnabled())
  fireEvent.click(mode)
  fireEvent.change(screen.getByRole('combobox', { name: 'Lead owner' }), {
    target: { value: waitlistIds.user },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'Open stage' }), {
    target: { value: waitlistIds.stage },
  })
}

it('loads only staff data, labels demo attribution, and performs no automatic write', async () => {
  render(<StaffWaitlistInbox />)
  expect(await screen.findByText('jamie@example.test')).toBeVisible()
  expect(screen.getByText('Receptionist demo')).toBeVisible()
  expect(screen.getByText(/Marking contacted records work/)).toBeVisible()
  expect(writes()).toHaveLength(0)
})
it('shows a denied state with no prospect details for an unauthorized user', async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 403,
    json: async () => ({ error: { message: 'Staff access required.' } }),
  })
  render(<StaffWaitlistInbox />)
  expect(await screen.findByText('Staff access required.')).toBeVisible()
  expect(screen.queryByText('jamie@example.test')).not.toBeInTheDocument()
  expect(writes()).toHaveLength(0)
})
it('records an explicit review change without sending a handoff', async () => {
  render(<StaffWaitlistInbox />)
  const button = await screen.findByRole('button', {
    name: 'Mark reviewed for jamie@example.test',
  })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0][1]).toMatchObject({
    method: 'PATCH',
    body: JSON.stringify({ reviewStatus: 'reviewed', expectedVersion: 0 }),
  })
})
it('requires a preview and explicit approval, clears approval on edits, and sends the reviewed snapshot', async () => {
  await prepare()
  expect(
    screen.queryByRole('button', { name: 'Confirm CRM handoff' }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Preview CRM handoff' }))
  const approve = await screen.findByRole('checkbox', {
    name: 'I approve this CRM handoff.',
  })
  await waitFor(() => expect(approve).toBeEnabled())
  expect(
    screen.getByRole('button', { name: 'Confirm CRM handoff' }),
  ).toBeDisabled()
  fireEvent.click(approve)
  fireEvent.change(screen.getByRole('textbox', { name: 'Lead first name' }), {
    target: { value: 'Jamie corrected' },
  })
  expect(
    screen.queryByRole('checkbox', { name: 'I approve this CRM handoff.' }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Preview CRM handoff' }))
  const fresh = await screen.findByRole('checkbox', {
    name: 'I approve this CRM handoff.',
  })
  await waitFor(() => expect(fresh).toBeEnabled())
  expect(fresh).not.toBeChecked()
  fireEvent.click(fresh)
  fireEvent.click(screen.getByRole('button', { name: 'Confirm CRM handoff' }))
  expect(
    await screen.findByRole('region', { name: 'CRM handoff receipt' }),
  ).toBeVisible()
  const commits = writes().filter(([url]) => String(url).endsWith('/handoff'))
  expect(commits).toHaveLength(1)
  expect(JSON.parse(commits[0][1].body)).toMatchObject({
    confirmed: true,
    previewVersion: 'a'.repeat(64),
    draft: {
      expectedVersion: 0,
      target: {
        firstName: 'Jamie corrected',
        assigneeId: waitlistIds.user,
        stageId: waitlistIds.stage,
      },
    },
  })
})
it('preserves an uncertain confirmation for safe reload rather than silently retrying', async () => {
  await prepare()
  fireEvent.click(screen.getByRole('button', { name: 'Preview CRM handoff' }))
  const approve = await screen.findByRole('checkbox', {
    name: 'I approve this CRM handoff.',
  })
  await waitFor(() => expect(approve).toBeEnabled())
  fireEvent.click(approve)
  const prior = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/handoff') && init?.method === 'POST')
      throw new Error('Synthetic network failure')
    return prior(url, init)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm CRM handoff' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/Reload handoff/)
  expect(
    writes().filter(([url]) => String(url).endsWith('/handoff')),
  ).toHaveLength(1)
})
it('keeps deleted-target receipts read-only without offering to recreate the lead', async () => {
  const prior = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url, init) =>
    String(url).endsWith('/handoff')
      ? {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              ...sampleWaitlistOptions(),
              receipt: { ...sampleWaitlistReceipt(), leadAvailable: false },
            },
          }),
        }
      : prior(url, init),
  )
  render(<StaffWaitlistInbox />)
  const open = await screen.findByRole('button', {
    name: 'Prepare CRM handoff for jamie@example.test',
  })
  await waitFor(() => expect(open).toBeEnabled())
  fireEvent.click(open)
  const receipt = await screen.findByRole('region', {
    name: 'CRM handoff receipt',
  })
  expect(receipt).toHaveTextContent('Lead no longer available')
  expect(
    screen.queryByRole('radio', { name: 'Create a new lead' }),
  ).not.toBeInTheDocument()
  expect(writes()).toHaveLength(0)
})

it('refreshes the active review filter after recording a status', async () => {
  const prior = fetchMock.getMockImplementation()!
  let updated = false
  fetchMock.mockImplementation(async (url, init) => {
    if (init?.method === 'PATCH') updated = true
    if (String(url).includes('reviewStatus=new') && updated)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: { entries: [], page: 1, hasNext: false, canHandoff: true },
        }),
      }
    return prior(url, init)
  })
  render(<StaffWaitlistInbox />)
  const filter = screen.getByRole('combobox', { name: 'Review filter' })
  await waitFor(() => expect(filter).toBeEnabled())
  fireEvent.change(filter, { target: { value: 'new' } })
  const button = await screen.findByRole('button', {
    name: 'Mark reviewed for jamie@example.test',
  })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  expect(
    await screen.findByText('No signups match this review filter.'),
  ).toBeVisible()
})

it('announces one status while a recorded change refreshes its list', async () => {
  const prior = fetchMock.getMockImplementation()!
  let patched = false
  let release: (() => void) | undefined
  fetchMock.mockImplementation(async (url, init) => {
    if (init?.method === 'PATCH') patched = true
    else if (patched)
      await new Promise<void>((resolve) => {
        release = resolve
      })
    return prior(url, init)
  })
  render(<StaffWaitlistInbox />)
  const button = await screen.findByRole('button', {
    name: 'Mark reviewed for jamie@example.test',
  })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  await waitFor(() => expect(release).toBeDefined())
  const statuses = screen.getAllByRole('status')
  await act(async () => {
    release?.()
  })
  expect(statuses).toHaveLength(1)
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Review status recorded',
  )
})
