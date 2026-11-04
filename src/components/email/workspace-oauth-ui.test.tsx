import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { GmailConnect } from './gmail-connect'
import { MicrosoftConnect } from './microsoft-connect'
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
for (const provider of ['gmail', 'microsoft'] as const)
  it(`${provider} waits for a business-bound initiation before navigating its popup and ignores unsolicited messages`, async () => {
    let finish!: (value: Response) => void
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) =>
        String(url).startsWith('/api/email/account')
          ? new Response('{"data":null}')
          : new Promise((resolve) => {
              finish = resolve
            }),
      )
    const popup = {
      location: { href: 'about:blank' },
      close: vi.fn(),
      closed: false,
    }
    const open = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as Window)
    const origin = window.location.origin
    const suffix =
      provider === 'gmail'
        ? '/api/email/callback'
        : '/api/email/microsoft/callback'
    render(
      provider === 'gmail' ? (
        <GmailConnect
          googleClientId="synthetic-client"
          redirectUri={`${origin}${suffix}`}
        />
      ) : (
        <MicrosoftConnect
          clientId="synthetic-client"
          redirectUri={`${origin}${suffix}`}
        />
      ),
    )
    const button = await screen.findByRole('button', {
      name: provider === 'gmail' ? 'Connect Gmail' : 'Connect Outlook',
    })
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin,
          data: {
            type: `${provider}-oauth-success`,
            data: { email: 'wrong@example.test' },
          },
        }),
      )
    })
    expect(button).toBeVisible()
    fireEvent.click(button)
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(open.mock.calls[0][0]).toBe('about:blank')
    expect(popup.location.href).toBe('about:blank')
    await act(async () => {
      finish(new Response('{"data":{"state":"synthetic-state"}}'))
    })
    const url = new URL(popup.location.href)
    expect(url.searchParams.get('state')).toBe('synthetic-state')
    expect(url.searchParams.get('redirect_uri')).toBe(`${origin}${suffix}`)
    expect(
      request.mock.calls.filter((call) => call[1]?.method === 'POST'),
    ).toHaveLength(1)
  })
