import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthBrandPanel } from './auth-brand-panel'

afterEach(() => vi.unstubAllEnvs())

describe('Authentication brand panel', () => {
  it.each(['true', 'false'])('describes product capabilities without unapproved claims when waitlist is %s', waitlist => {
    vi.stubEnv('WAITLIST_ENABLED', waitlist)
    const { container } = render(<AuthBrandPanel />)
    const copy = container.textContent ?? ''

    expect(copy).not.toMatch(/SOC\s*2|GDPR|certified|compliant|uptime/i)
    expect(copy).not.toMatch(/\d+(?:\.\d+)?\s*%|\b6\.2\b|hours? saved|hrs saved|forecast accuracy|autopilot/i)
    expect(copy).toMatch(/leads?/i)
    expect(copy).toMatch(/drafts?/i)
    expect(copy).toMatch(/pipeline/i)
    expect(screen.getByText('Flowrish', { exact: true })).toBeInTheDocument()
    expect(Boolean(screen.queryByText('Private beta', { exact: true }))).toBe(waitlist === 'true')
  })
})
