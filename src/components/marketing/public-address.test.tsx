import { cleanup, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ waitlist: false, authenticated: false }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.authenticated ? { id: 'sample-user' } : null },
      }),
    },
  }),
}))
vi.mock('@/lib/waitlist', () => ({ isWaitlistEnabled: () => state.waitlist }))
vi.mock('./waitlist-form', () => ({
  WaitlistForm: () => <div>Waitlist form</div>,
}))
vi.mock('@/server/actions/onboarding', () => ({
  createOrg: vi.fn(async () => ({
    error: 'No real submissions in this test.',
  })),
  joinOrg: vi.fn(async () => ({ error: 'No real submissions in this test.' })),
}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw Error(`Redirect to ${path}`)
  },
}))

import LandingPage from '@/app/(marketing)/page'
import { PricingSection } from './pricing-section'
import { OnboardingForm } from '@/app/(auth)/onboarding/onboarding-form'

beforeEach(() => {
  state.waitlist = false
  state.authenticated = false
})
afterEach(cleanup)
describe('public domain and contact references', () => {
  it.each([false, true])(
    'renders the public landing with working signup links and no invented contact in waitlist mode %s',
    async (waitlist) => {
      state.waitlist = waitlist
      const html = renderToStaticMarkup(await LandingPage()),
        page = document.createElement('div')
      page.innerHTML = html
      expect(page.querySelectorAll('a[href^="mailto:"]')).toHaveLength(0)
      expect(html).not.toMatch(
        /(?:app\.)?flowrish\.com|Book a demo|Talk to sales/,
      )
      expect(
        page.querySelector(
          `a[href="${waitlist ? '#waitlist' : '/onboarding'}"]`,
        ),
      ).not.toBe(null)
      const entities = JSON.parse(
        page.querySelector('script[type="application/ld+json"]')!.textContent!,
      )['@graph']
      expect(
        entities.every(
          (entity: { url: string }) =>
            entity.url === 'https://flowrish.marckengland.com/',
        ),
      ).toBe(true)
      expect(page.textContent).toContain('flowrish.marckengland.com')
      expect(page.textContent).toContain('Our team will confirm pricing')
      expect(page.textContent).not.toMatch(
        /\$\d|trial|per seat|seat\/mo|billed|−20%|most popular|volume & annual/i,
      )
      expect(page.textContent).toContain('Waitlist form')
      expect(
        page.querySelectorAll('#pricing a[href="#waitlist"]'),
      ).toHaveLength(2)
    },
  )
  it('keeps authenticated visitors routed into the CRM', async () => {
    state.authenticated = true
    await expect(LandingPage()).rejects.toThrow('Redirect to /dashboard')
  })
  it('hides the unconfigured sales action while preserving signup and confirmed pricing wording', () => {
    render(<PricingSection getStartedHref="/onboarding" />)
    expect(
      screen.queryByRole('link', { name: 'Talk to sales' }),
    ).not.toBeInTheDocument()
    expect(
      screen
        .getAllByRole('link', { name: 'Get started' })
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/onboarding', '/onboarding'])
    expect(
      screen.queryByRole('button', { name: 'Monthly' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Annual/ }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByText('Our team will confirm pricing')).toHaveLength(3)
    expect(document.body.textContent).not.toMatch(
      /\$\d|trial|per seat|seat\/mo|billed|−20%|most popular|volume & annual/i,
    )
  })
  it('keeps the waitlist as the public pricing contact path', () => {
    render(
      <PricingSection
        getStartedHref="#waitlist"
        primaryLabel="Join the waitlist"
      />,
    )
    expect(
      screen
        .getAllByRole('link', { name: 'Join the waitlist' })
        .map((link) => link.getAttribute('href')),
    ).toEqual(['#waitlist', '#waitlist'])
    expect(screen.getByText('Lead & contact management')).toBeVisible()
    expect(screen.getByText('Cadences & Rhythm engine')).toBeVisible()
    expect(screen.getByText('Audit log & SLAs')).toBeVisible()
  })
  it('renders a supplied real sales destination without changing the default', () => {
    render(
      <PricingSection
        getStartedHref="/onboarding"
        talkToSalesHref="https://contact.example/sales"
      />,
    )
    expect(screen.getByRole('link', { name: 'Talk to sales' })).toHaveAttribute(
      'href',
      'https://contact.example/sales',
    )
  })
  it('shows the current host beside the workspace slug without submitting onboarding', () => {
    render(<OnboardingForm />)
    expect(screen.getByText('flowrish.marckengland.com/')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'URL slug' })).toBeVisible()
  })
})
