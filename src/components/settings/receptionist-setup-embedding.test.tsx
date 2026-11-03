import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeLibrary } from '@/components/knowledge/knowledge-library'
import { WebsiteReceptionistSettings } from './website-receptionist-settings'
const id = '11111111-1111-4111-8111-111111111111'
const website = { settings: { publicId: id, enabled: false, allowedOrigins: ['https://shop.example'], dailyMessageLimit: 5, dailyTokenLimit: 20000, dailyCallbackLimit: 10, updatedAt: '2026-11-03T00:00:00.000Z' }, hasSavedBusiness: true, hasOrganizationAi: true, approvedDocuments: 1, usage: { sessions: 0, messages: 0, reservedTokens: 0, callbacks: 0 } }
const fetch = vi.fn()
beforeEach(() => { fetch.mockReset(); vi.stubGlobal('fetch', fetch) })
describe('embedded setup editors reuse existing behavior', () => {
  it('configures website limits without offering activation or callback operations', async () => {
    const dirty = vi.fn(), changed = vi.fn()
    render(<WebsiteReceptionistSettings setupOnly initialData={website} onDirtyChange={dirty} onSaved={changed} />)
    expect(fetch).not.toHaveBeenCalled(); expect(screen.queryByRole('checkbox', { name: 'Enable website receptionist' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Load callback requests' })).toBeNull()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Daily message limit' }), { target: { value: '6' } }); await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true))
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ...website, settings: { ...website.settings, dailyMessageLimit: 6 } } }) }); fireEvent.click(screen.getByRole('button', { name: 'Save website receptionist settings' })); await waitFor(() => expect(changed).toHaveBeenCalledTimes(1)); expect(JSON.parse(fetch.mock.calls[0][1].body).enabled).toBe(false)
  })
  it('reports Library edits/busy state and only seeds an unsaved hours draft', async () => {
    const dirty = vi.fn(), busy = vi.fn(); fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
    render(<KnowledgeLibrary embedded onDirtyChange={dirty} onBusyChange={busy} template={{ title: 'Opening hours', category: 'GENERAL', contentText: 'Monday: 09:00–17:00' }} />)
    await screen.findByText('No documents yet. Add pricing, services, or FAQs to get started.'); fireEvent.click(screen.getByRole('button', { name: 'Use saved hours in a new draft' })); expect(screen.getByRole('textbox', { name: 'Document text' })).toHaveValue('Monday: 09:00–17:00'); await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true)); expect(busy).toHaveBeenLastCalledWith(false); expect(fetch).toHaveBeenCalledTimes(1)
  })
})
