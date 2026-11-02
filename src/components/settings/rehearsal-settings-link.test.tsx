import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '@/app/(dashboard)/settings/page'

const rehearsalId = '39a92f81-0c90-4bf3-971d-1ce39ca77b20'
const fixture = { config: { enabled: false, businessName: 'Workshop', knowledge: '', mode: 'after_hours', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: '11111111-1111-4111-8111-111111111111', stageId: '' }, businessName: 'Workshop', currentUserId: '11111111-1111-4111-8111-111111111111', webhookPath: '/api/voice/receptionist/org-1', members: [], stages: [], calls: [] }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

describe('settings rehearsal links', () => {
  it('selects the receptionist section and fetches the exact report using read-only requests', async () => {
    window.history.replaceState({}, '', `/settings?section=receptionist&rehearsal=${rehearsalId}`)
    const request = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => {
      if (url === '/api/admin/receptionist') return fixture
      if (url === `/api/admin/receptionist/rehearsals/${rehearsalId}`) return { data: { id: rehearsalId, title: 'Archived history report', createdAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z', verdict: 'unreviewed', notes: '', unansweredMessageIndexes: [], snapshot: { clientId: '13992f81-0c90-4bf3-971d-1ce39ca77b20', settingsVersion: '2026-11-01T00:00:00.000Z', finished: false, messages: [{ role: 'caller', content: 'How much?', generation: 'scripted', sources: [] }] } } }
      return { data: [] }
    } }))
    vi.stubGlobal('fetch', request)
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SettingsPage /></QueryClientProvider>)
    await screen.findByRole('heading', { name: 'Archived history report' })
    expect(screen.getByRole('button', { name: 'AI receptionist' })).toHaveAttribute('aria-current', 'page')
    expect(request.mock.calls.map(call => call[0])).toEqual(['/api/admin/receptionist', `/api/admin/receptionist/rehearsals/${rehearsalId}`])
    expect(request.mock.calls.every(call => call[1]?.method === undefined || call[1]?.method === 'GET')).toBe(true)
  })
})
