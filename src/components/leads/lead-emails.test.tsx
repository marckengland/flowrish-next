import { beforeEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
vi.mock('@/components/email/email-compose', () => ({ EmailCompose: () => <p>Compose retained address</p> }))
import { EmailsTab } from './lead-emails'
const message = { id: 'message', externalId: 'external', threadId: 'thread', fromEmail: 'archived@example.invalid', toEmail: 'owner@example.invalid', subject: 'Preserved archived conversation', bodyPreview: 'Retained email history', sentAt: '2026-11-05T00:00:00.000Z', isOutbound: false }
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ threadId: 'thread', messages: [message] }] })))) })
function mount(email: string | null) { render(<QueryClientProvider client={new QueryClient()}><EmailsTab leadId="lead" leadName="Practice" leadEmail={email} canWrite /></QueryClientProvider>) }
it('shows linked conversation history for a retained lead without an address and offers no reply or compose', async () => { mount(null); await screen.findByText('Preserved archived conversation'); expect(screen.queryByRole('button', { name: /^Reply$/ })).not.toBeInTheDocument(); expect(screen.queryByText('Compose retained address')).not.toBeInTheDocument() })
it('keeps a transferred conversation read-only when it does not involve the retained email address', async () => { mount('keeper@example.invalid'); await screen.findByText('Preserved archived conversation'); expect(screen.queryByRole('button', { name: /^Reply$/ })).not.toBeInTheDocument(); expect(screen.getByText('Compose retained address')).toBeInTheDocument() })
it('retains reply controls for conversations involving the current retained address', async () => { mount('archived@example.invalid'); await screen.findByText('Preserved archived conversation'); expect(screen.getByRole('button', { name: /^Reply$/ })).toBeEnabled() })
