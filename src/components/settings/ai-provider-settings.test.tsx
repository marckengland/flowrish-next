import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AiProviderSettingsView } from '@/lib/ai-provider'
import { AiProviderSettings } from './ai-provider-settings'

const version = '2026-11-02T00:00:00.000Z'
const emptyView: AiProviderSettingsView = {
  config: null,
  usage: { day: '2026-11-02', requests: 0, reservedTokens: 0, reportedTokens: 0, completedRequests: 0, failedRequests: 0 },
  platformAvailable: true,
}
const savedView: AiProviderSettingsView = {
  ...emptyView,
  config: { provider: 'deepseek', model: 'deepseek-flash', enabled: true, hasKey: true, dailyRequestLimit: 20, dailyTokenLimit: 50000, maxOutputTokens: 2048, maxInputBytes: 16000, updatedAt: version },
  usage: { day: '2026-11-02', requests: 3, reservedTokens: 10000, reportedTokens: 650, completedRequests: 2, failedRequests: 1 },
}

function response(data: AiProviderSettingsView): Response {
  return Response.json({ data })
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { cleanup() })

describe('AiProviderSettings', () => {
  it('saves organization defaults without testing automatically or retaining the entered key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(emptyView))
      .mockResolvedValueOnce(response(savedView))
    render(<AiProviderSettings />)
    const key = await screen.findByLabelText('API key')
    expect(key).toHaveAttribute('type', 'password')
    expect(key).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByText(/Platform AI is available/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Test saved connection' })).toBeDisabled()
    fireEvent.change(key, { target: { value: 'fixture-ai-key-not-real' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save AI provider' }))
    expect(key).toHaveValue('')
    expect(await screen.findByRole('status')).toHaveTextContent('AI provider settings saved.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
      provider: 'deepseek', model: 'deepseek-flash', apiKey: 'fixture-ai-key-not-real', enabled: true,
      dailyRequestLimit: 20, dailyTokenLimit: 50000, maxOutputTokens: 2048, maxInputBytes: 16000,
      expectedUpdatedAt: null,
    })
    expect(fetchMock.mock.calls[1][1]?.method).toBe('PUT')
  })

  it('keeps the saved key for the same provider and supports pausing without removing configuration', async () => {
    const pausedView = { ...savedView, config: { ...savedView.config!, enabled: false, updatedAt: '2026-11-02T01:00:00.000Z' } }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(savedView)).mockResolvedValueOnce(response(pausedView))
    render(<AiProviderSettings />)
    expect(await screen.findByLabelText('API key')).toHaveValue('')
    expect(screen.getByText(/Leave blank to keep the saved key/)).toBeVisible()
    fireEvent.click(screen.getByLabelText('Enable organization AI'))
    fireEvent.click(screen.getByRole('button', { name: 'Save AI provider' }))
    expect(await screen.findByRole('status')).toHaveTextContent('AI provider settings saved.')
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({ apiKey: '', provider: 'deepseek', enabled: false, expectedUpdatedAt: version })
    expect(screen.getByText(/Organization AI is paused/)).toBeVisible()
    expect(screen.queryByRole('button', { name: /delete|remove|reset/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test saved connection' })).toBeDisabled()
  })

  it('clears keys on provider changes and requires a replacement instead of reusing another provider key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(savedView))
    render(<AiProviderSettings />)
    const key = await screen.findByLabelText('API key')
    fireEvent.change(key, { target: { value: 'fixture-replacement-not-real' } })
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'gemini' } })
    expect(key).toHaveValue('')
    expect(screen.getByLabelText('Model')).toHaveValue('gemini-3.1-flash-lite')
    expect(screen.getByText(/Enter a new key for this provider/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Save AI provider' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/API key/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } })
    expect(screen.getByLabelText('Model')).toHaveValue('')
    fireEvent.change(key, { target: { value: 'fixture-replacement-not-real' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save AI provider' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/model/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('tests only the unchanged saved version after an explicit click', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(savedView)).mockResolvedValueOnce(Response.json({ data: { ok: true } }))
    render(<AiProviderSettings />)
    await screen.findByLabelText('API key')
    const testButton = screen.getByRole('button', { name: 'Test saved connection' })
    expect(testButton).toBeEnabled()
    expect(screen.getByText(/one request/i)).toBeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Maximum output tokens'), { target: { value: '1024' } })
    expect(testButton).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Maximum output tokens'), { target: { value: '2048' } })
    fireEvent.click(testButton)
    expect(await screen.findByRole('status')).toHaveTextContent('Connection test succeeded.')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/ai-provider/test')
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({ expectedUpdatedAt: version })
    expect(fetchMock.mock.calls[1][1]?.method).toBe('POST')
  })

  it('renders UTC usage with reserved and reported tokens separately', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(savedView))
    render(<AiProviderSettings />)
    await screen.findByLabelText('API key')
    expect(screen.getByText('2026-11-02 (UTC)')).toBeVisible()
    expect(screen.getByLabelText('Requests used')).toHaveTextContent('3')
    expect(screen.getByLabelText('Reserved tokens used')).toHaveTextContent('10,000')
    expect(screen.getByLabelText('Provider-reported tokens')).toHaveTextContent('650')
    expect(screen.getByLabelText('Completed requests')).toHaveTextContent('2')
    expect(screen.getByLabelText('Failed requests')).toHaveTextContent('1')
    expect(screen.getByText(/not a dollar billing cap/i)).toBeVisible()
  })

  it('preserves non-secret edits on a conflict and reloads only on request', async () => {
    const nextView = { ...savedView, config: { ...savedView.config!, model: 'updated-model', updatedAt: '2026-11-02T02:00:00.000Z' } }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(savedView))
      .mockResolvedValueOnce(Response.json({ error: { code: 'CONFLICT', message: 'untrusted fixture-key-not-real' } }, { status: 409 }))
      .mockResolvedValueOnce(response(nextView))
    render(<AiProviderSettings />)
    const key = await screen.findByLabelText('API key')
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'my-edited-model' } })
    fireEvent.change(key, { target: { value: 'fixture-key-not-real' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save AI provider' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed/i)
    expect(screen.getByLabelText('Model')).toHaveValue('my-edited-model')
    expect(key).toHaveValue('')
    expect(document.body).not.toHaveTextContent('untrusted fixture-key-not-real')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Test saved connection' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save AI provider' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved settings' }))
    await waitFor(() => expect(screen.getByLabelText('Model')).toHaveValue('updated-model'))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(screen.getByLabelText('API key')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Test saved connection' })).toBeEnabled()
  })

  it('never displays raw provider failures or network error details', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(savedView))
      .mockResolvedValueOnce(Response.json({ error: { code: 'PROVIDER_ERROR', message: 'Bearer fixture-key-not-real' } }, { status: 502 }))
      .mockRejectedValueOnce(new Error('network fixture-key-not-real'))
    render(<AiProviderSettings />)
    await screen.findByLabelText('API key')
    fireEvent.click(screen.getByRole('button', { name: 'Test saved connection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection test failed.')
    expect(document.body).not.toHaveTextContent('fixture-key-not-real')
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'changed-model' } })
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'fixture-key-not-real' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save AI provider' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save AI provider settings.'))
    expect(screen.getByLabelText('API key')).toHaveValue('')
    expect(document.body).not.toHaveTextContent('fixture-key-not-real')
  })

  it('shows an administrator-only load error without rendering a credential form', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ error: { code: 'FORBIDDEN', message: 'internal authorization details' } }, { status: 403 }))
    render(<AiProviderSettings />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/administrator/i)
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('internal authorization details')
  })

  it('retries a failed initial load and explains when platform AI is unavailable', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('private network details'))
      .mockResolvedValueOnce(response({ ...emptyView, platformAvailable: false }))
    render(<AiProviderSettings />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load AI provider settings.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByLabelText('API key')
    expect(screen.getByText(/Platform AI is unavailable/)).toBeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('clears the password on unmount without persisting credentials to browser storage', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(savedView))
    const localStore = vi.spyOn(Storage.prototype, 'setItem')
    const { unmount } = render(<AiProviderSettings />)
    const key = await screen.findByLabelText('API key')
    fireEvent.change(key, { target: { value: 'fixture-key-not-real' } })
    unmount()
    expect(key).toHaveValue('')
    expect(localStore).not.toHaveBeenCalled()
  })

  it('ignores a load result after unmount and aborts the request', async () => {
    let complete: (response: Response) => void = () => {}
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve }))
    const { unmount } = render(<AiProviderSettings />)
    unmount()
    expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true)
    await act(async () => { complete(response(savedView)) })
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
  })
})
