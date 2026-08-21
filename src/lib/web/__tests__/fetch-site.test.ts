import { describe, it, expect, vi, beforeEach } from 'vitest'

// `server-only` is aliased to a stub in vitest.config.ts.
import { isBlockedAddress, htmlToText, fetchSiteText } from '@/lib/web/fetch-site'

// DNS is injected via `lookupFn` (no node:dns mocking needed).
const mockLookup = vi.fn()
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function htmlResponse(body: string) {
  return {
    status: 200,
    ok: true,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  }
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so queued mockResolvedValueOnce
  // impls never leak between tests.
  vi.resetAllMocks()
})

describe('isBlockedAddress', () => {
  it('blocks loopback / private / link-local / metadata IPv4', () => {
    for (const ip of [
      '0.0.0.0',
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1', // CGNAT
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true)
    }
  })

  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '93.184.216.34', '1.1.1.1', '172.32.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(false)
    }
  })

  it('handles IPv6 loopback / link-local / unique-local and mapped v4', () => {
    expect(isBlockedAddress('::1')).toBe(true)
    expect(isBlockedAddress('fe80::1')).toBe(true)
    expect(isBlockedAddress('fd00::1')).toBe(true)
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedAddress('2607:f8b0:4005:80a::200e')).toBe(false)
  })

  it('treats non-IP strings as blocked', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true)
  })
})

describe('htmlToText', () => {
  it('strips scripts, styles, tags and collapses whitespace', () => {
    const html =
      '<html><head><style>.x{color:red}</style></head><body><h1>Acme</h1>' +
      '<p>We build   robots.</p><script>evil()</script></body></html>'
    expect(htmlToText(html)).toBe('Acme We build robots.')
  })
})

describe('fetchSiteText — SSRF guards', () => {
  it('returns null for non-http(s) protocols (no fetch)', async () => {
    expect(await fetchSiteText('ftp://example.com')).toBeNull()
    expect(await fetchSiteText('file:///etc/passwd')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null for a private IP literal without fetching', async () => {
    expect(await fetchSiteText('http://169.254.169.254/latest/meta-data')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null when the hostname resolves to a private address', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.1' }])
    expect(
      await fetchSiteText('http://internal.local', { lookupFn: mockLookup }),
    ).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not follow a redirect to a private address', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34' }])
    mockFetch.mockResolvedValueOnce({
      status: 301,
      ok: false,
      headers: { get: (k: string) => (k.toLowerCase() === 'location' ? 'http://169.254.169.254/' : null) },
    })
    expect(
      await fetchSiteText('https://example.com', { lookupFn: mockLookup }),
    ).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1) // stopped before fetching the internal host
  })

  it('fetches and extracts text from a safe public site', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34' }])
    mockFetch.mockResolvedValueOnce(
      htmlResponse('<html><body><h1>Acme Robotics</h1><p>We automate warehouses.</p></body></html>'),
    )
    const text = await fetchSiteText('https://acme.example.com', {
      lookupFn: mockLookup,
    })
    expect(text).toBe('Acme Robotics We automate warehouses.')
  })

  it('returns null for non-HTML content types', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34' }])
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/pdf' : null) },
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    expect(
      await fetchSiteText('https://acme.example.com/file.pdf', { lookupFn: mockLookup }),
    ).toBeNull()
  })
})
