import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceptionistHome } from './receptionist-home'
import { homeFixture } from './home-fixture.test-data'
import { Header } from '@/components/layout/header'
const fetch = vi.fn()
vi.mock('next/navigation', () => ({ usePathname: () => '/receptionist/callbacks', useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/notifications/notification-bell', () => ({ NotificationBell: () => null }))
beforeEach(() => { fetch.mockReset(); vi.stubGlobal('fetch', fetch) })
afterEach(() => { vi.unstubAllGlobals() })
describe('Receptionist callback inbox navigation', () => {
  it('opens the dedicated inbox from administrator home', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ data: homeFixture() }) }); render(<ReceptionistHome />)
    expect(await screen.findByRole('link', { name: 'Review callback requests' })).toHaveAttribute('href', '/receptionist/callbacks'); expect(fetch).toHaveBeenCalledOnce()
  })
  it('does not advertise the administrator inbox to CRM staff', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ data: homeFixture(false, true) }) }); render(<ReceptionistHome />); await screen.findByRole('heading', { name: 'Sample Organization' }); expect(screen.queryByRole('link', { name: 'Review callback requests' })).toBeNull(); expect(screen.getByRole('link', { name: 'Callback work queue' })).toBeInTheDocument()
  })
  it('uses a distinct callback inbox breadcrumb', () => {
    render(<Header user={{ name: 'Sample member', email: 'member@example.test' }} organizationName="Sample org" />); expect(screen.getByText('Callback inbox', { exact: true })).toBeInTheDocument()
  })
})
