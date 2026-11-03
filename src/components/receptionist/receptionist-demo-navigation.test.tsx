import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ReceptionistHome } from './receptionist-home'
import { homeFixture } from './home-fixture.test-data'

it('offers the isolated demo from Receptionist home', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: homeFixture() }) }))
  try {
    render(<ReceptionistHome />)
    expect(await screen.findByRole('link', { name: 'Demo mode' })).toHaveAttribute('href', '/receptionist/demo')
  } finally { vi.unstubAllGlobals() }
})
