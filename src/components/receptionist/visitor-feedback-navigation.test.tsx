import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceptionistHome } from './receptionist-home'
import { homeFixture } from './home-fixture.test-data'
import { Header } from '@/components/layout/header'
const fetch = vi.fn()
vi.mock('next/navigation', () => ({ usePathname: () => '/receptionist/feedback', useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/notifications/notification-bell', () => ({ NotificationBell: () => null }))
beforeEach(() => { fetch.mockReset(); vi.stubGlobal('fetch', fetch) }); afterEach(() => { vi.unstubAllGlobals() })
describe('visitor feedback navigation', () => {
  it('links administrator home to visitor feedback without fetching feedback automatically', async () => { fetch.mockResolvedValue({ ok: true, json: async () => ({ data: homeFixture() }) }); render(<ReceptionistHome />); expect(await screen.findByRole('link', { name: 'Visitor feedback' })).toHaveAttribute('href', '/receptionist/feedback'); expect(fetch).toHaveBeenCalledOnce() })
  it('does not advertise private visitor reports to CRM staff', async () => { fetch.mockResolvedValue({ ok: true, json: async () => ({ data: homeFixture(false, true) }) }); render(<ReceptionistHome />); await screen.findByRole('heading', { name: 'Sample Organization' }); expect(screen.queryByRole('link', { name: 'Visitor feedback' })).toBeNull() })
  it('labels the feedback breadcrumb distinctly', () => { render(<Header user={{ name: 'Synthetic Member', email: 'member@example.invalid' }} organizationName="Synthetic business" />); expect(screen.getByText('Visitor feedback', { exact: true })).toBeInTheDocument() })
})
