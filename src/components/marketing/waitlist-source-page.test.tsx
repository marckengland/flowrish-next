import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}))
vi.mock('@/lib/waitlist', () => ({ isWaitlistEnabled: () => false }))
vi.mock('./waitlist-form', () => ({
  WaitlistForm: ({ source }: { source: string }) => (
    <div data-waitlist-source={source} />
  ),
}))
import Page from '@/app/(marketing)/page'
it.each([
  ['receptionist-demo', 'public_demo'],
  ['untrusted', 'landing'],
  [undefined, 'landing'],
  [['receptionist-demo', 'untrusted'], 'landing'],
])(
  'uses only the fixed source mapping for homepage query %j',
  async (source, expected) => {
    const page = document.createElement('div')
    page.innerHTML = renderToStaticMarkup(
      await Page({
        searchParams: Promise.resolve({
          source: source as string | string[] | undefined,
        }),
      }),
    )
    expect(page.querySelector('[data-waitlist-source]')).toHaveAttribute(
      'data-waitlist-source',
      expected,
    )
  },
)
