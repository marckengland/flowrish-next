import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AiProviderSettingsView } from '@/lib/ai-provider'
import { AiProviderSettings } from './ai-provider-settings'
const saved: AiProviderSettingsView = {
 config: { provider: 'deepseek', model: 'deepseek-flash', enabled: true, hasKey: true, dailyRequestLimit: 20, dailyTokenLimit: 50000, maxOutputTokens: 2048, maxInputBytes: 16000, updatedAt: '2026-11-02T00:00:00.000Z' },
 usage: { day: '2026-11-02', requests: 0, reservedTokens: 0, reportedTokens: 0, completedRequests: 0, failedRequests: 0 }, platformAvailable: false,
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it.each([saved, { ...saved, config: null }])('shows the readable DeepSeek model name for saved and initial settings', async view => {
 const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: view }))
 render(<AiProviderSettings />)
 expect(await screen.findByText('DeepSeek V4.1 Flash', { exact: true })).toBeVisible()
 expect(screen.getByLabelText('Model')).toHaveValue('deepseek-flash')
 expect(screen.getByLabelText('Model')).toHaveAccessibleDescription(/DeepSeek V4.1 Flash/)
 expect(screen.getByLabelText('API key')).toHaveValue('')
 expect(fetch).toHaveBeenCalledTimes(1)
 expect(fetch.mock.calls[0][0]).toBe('/api/admin/ai-provider')
})
it('does not label another provider or a custom model as DeepSeek V4.1 Flash', async () => {
 vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: saved }))
 render(<AiProviderSettings />)
 await screen.findByLabelText('Model')
 fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'deepseek-v4-pro' } })
 expect(screen.queryByText('DeepSeek V4.1 Flash', { exact: true })).not.toBeInTheDocument()
 fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'gemini' } })
 expect(screen.queryByText('DeepSeek V4.1 Flash', { exact: true })).not.toBeInTheDocument()
})
it('keeps the API identifier in saved payloads and makes no connection-test request', async () => {
 const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ data: saved })).mockResolvedValueOnce(Response.json({ data: { ...saved, config: { ...saved.config, enabled: false } } }))
 render(<AiProviderSettings />)
 await screen.findByText('DeepSeek V4.1 Flash', { exact: true })
 fireEvent.click(screen.getByLabelText('Enable organization AI'))
 fireEvent.click(screen.getByRole('button', { name: 'Save AI provider' }))
 await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('saved'))
 expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash', apiKey: '', enabled: false })
 expect(fetch.mock.calls.map(call => [call[0], call[1]?.method ?? 'GET'])).toEqual([['/api/admin/ai-provider', 'GET'], ['/api/admin/ai-provider', 'PUT']])
})
