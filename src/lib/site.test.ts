import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})
describe('public site address', () => {
  it.each([undefined, '', '   '])(
    'defaults to the current public address when the override is %s',
    async (value) => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', value)
      vi.resetModules()
      const { siteConfig } = await import('./site')
      expect(siteConfig.url).toBe('https://flowrish.marckengland.com')
    },
  )
  it.each([
    'https://flowrish.com',
    'https://app.flowrish.com/',
    ' https://www.flowrish.com/ ',
  ])('replaces an obsolete configured brand domain %s', async (value) => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', value)
    vi.resetModules()
    const { siteConfig } = await import('./site')
    expect(siteConfig.url).toBe('https://flowrish.marckengland.com')
  })
  it('preserves an explicitly configured future or preview address', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://preview.example/')
    vi.resetModules()
    const { siteConfig } = await import('./site')
    expect(siteConfig.url).toBe('https://preview.example')
  })
  it('uses the same address in sitemap and robots without exposing app pages', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined)
    vi.resetModules()
    const { default: sitemap } = await import('@/app/sitemap'),
      { default: robots } = await import('@/app/robots')
    expect(sitemap().map((row) => row.url)).toEqual([
      'https://flowrish.marckengland.com/',
    ])
    expect(robots()).toMatchObject({
      host: 'https://flowrish.marckengland.com',
      sitemap: 'https://flowrish.marckengland.com/sitemap.xml',
    })
  })
})
