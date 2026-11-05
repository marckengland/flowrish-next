import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/components/email/rich-text-editor', () => ({ RichTextEditor: ({ defaultValue, onChange }: { defaultValue: string; onChange: (value: string) => void }) => <textarea aria-label="Private email body" defaultValue={defaultValue} onChange={event => onChange(event.target.value)} /> }))
vi.mock('@/components/ai/email-generator', () => ({ EmailGenerator: () => null }))
import { EmailCompose } from './email-compose'
import { WorkspaceIdentityProvider } from '@/components/layout/workspace-identity'
const context = { organizationId: 'org', userId: 'actor' }, props = { leadId: 'lead', leadEmail: 'lead@example.invalid', leadName: 'Private lead', defaultSubject: 'Private subject', defaultBody: 'Private body', followUpId: 'followup' }, fetchMock = vi.fn()
beforeEach(() => { cleanup(); vi.resetAllMocks(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { messageId: 'sent', threadId: 'thread', attachmentCount: 0 }, scope: context, capabilities: { canWrite: true } }))) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('binds even a manual follow-up template to its source and captured actor only after explicit Send', async () => {
  render(<WorkspaceIdentityProvider {...context}><EmailCompose {...props} /></WorkspaceIdentityProvider>); expect(fetchMock).not.toHaveBeenCalled(); fireEvent.submit(screen.getByRole('form')); await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce()); const options = fetchMock.mock.calls[0][1]; expect(options.headers['x-flowrish-follow-up-scope']).toBe(JSON.stringify(['org', 'actor'])); expect(JSON.parse(options.body)).toMatchObject({ leadId: 'lead', followUpId: 'followup' }); expect(JSON.parse(options.body)).not.toHaveProperty('draftVersion')
})
it('hides private composer state on actor change and never dispatches as the replacement actor', async () => {
  const view = render(<WorkspaceIdentityProvider {...context}><EmailCompose {...props} /></WorkspaceIdentityProvider>); fireEvent.change(screen.getByRole('textbox', { name: 'Private email body' }), { target: { value: 'Confidential unsent edit' } }); view.rerender(<WorkspaceIdentityProvider {...context} userId="other"><EmailCompose {...props} /></WorkspaceIdentityProvider>); await screen.findByText(/Access changed.*Reload/); expect(screen.queryByRole('textbox', { name: 'Private email body' })).not.toBeInTheDocument(); expect(fetchMock).not.toHaveBeenCalled()
})
it('clears a revoked draft rather than retaining private fields for another attempt', async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Access revoked' } }), { status: 403 })); render(<WorkspaceIdentityProvider {...context}><EmailCompose {...props} /></WorkspaceIdentityProvider>); fireEvent.submit(screen.getByRole('form')); await screen.findByText(/Access changed.*Reload/); expect(screen.queryByRole('textbox', { name: 'Subject' })).not.toBeInTheDocument(); expect(screen.queryByRole('textbox', { name: 'Private email body' })).not.toBeInTheDocument(); expect(fetchMock).toHaveBeenCalledOnce()
})
