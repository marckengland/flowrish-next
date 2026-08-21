import 'server-only'
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

/**
 * SSRF-safe website text fetcher used by AI account research.
 *
 * Fetching a URL that ultimately comes from user-editable data (a
 * company's `website`) server-side is an SSRF risk: a crafted host could
 * point at internal services or the cloud metadata endpoint. This helper
 * defends against that:
 *   - only http/https,
 *   - resolves DNS and rejects the request if ANY resolved address is
 *     private / loopback / link-local / unique-local / metadata,
 *   - re-validates on every redirect hop (redirect-based SSRF bypass),
 *   - caps time and bytes, and only accepts HTML/text content.
 *
 * It never throws — on any problem it returns `null` so callers degrade
 * gracefully (research still runs without live site content).
 */

/** DNS resolver shape — injectable so tests don't touch real DNS. */
type LookupFn = (
  hostname: string,
  options: { all: true },
) => Promise<ReadonlyArray<{ address: string }>>

interface FetchSiteOptions {
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  /** Override DNS resolution (tests only). Defaults to node:dns lookup. */
  lookupFn?: LookupFn
}

/** True for addresses we must never let the server reach. */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) {
    const parts = ip.split('.').map((n) => Number.parseInt(n, 10))
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true
    const [a, b] = parts
    if (a === 0) return true // 0.0.0.0/8
    if (a === 10) return true // 10.0.0.0/8 private
    if (a === 127) return true // loopback
    if (a === 169 && b === 254) return true // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true // 192.168.0.0/16 private
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
    return false
  }
  if (kind === 6) {
    const lower = ip.toLowerCase()
    if (lower === '::1' || lower === '::') return true // loopback / unspecified
    if (lower.startsWith('fe80')) return true // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique-local
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — validate the embedded v4.
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isBlockedAddress(mapped[1])
    return false
  }
  return true // not a valid IP → treat as blocked
}

/** Resolves a hostname and returns true if it's safe to fetch. */
async function hostIsSafe(hostname: string, lookupFn: LookupFn): Promise<boolean> {
  if (isIP(hostname)) return !isBlockedAddress(hostname)
  try {
    const results = await lookupFn(hostname, { all: true })
    if (results.length === 0) return false
    // Conservative: block if ANY resolved address is internal.
    return results.every((r) => !isBlockedAddress(r.address))
  } catch {
    return false
  }
}

/**
 * Fetches `rawUrl` and returns plain text extracted from the page, or
 * `null` if the URL is unsafe/unreachable/non-HTML.
 */
export async function fetchSiteText(
  rawUrl: string,
  {
    maxBytes = 500_000,
    timeoutMs = 8000,
    maxRedirects = 3,
    lookupFn = lookup as unknown as LookupFn,
  }: FetchSiteOptions = {},
): Promise<string | null> {
  let current: URL
  try {
    current = new URL(rawUrl)
  } catch {
    return null
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        return null
      }
      if (!(await hostIsSafe(current.hostname, lookupFn))) return null

      const res = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual', // we re-validate each hop ourselves
        headers: {
          'user-agent': 'FlowrishBot/1.0 (+account-research)',
          accept: 'text/html,application/xhtml+xml,text/plain',
        },
      })

      // Follow redirects manually so each new host is re-checked.
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) return null
        current = new URL(location, current)
        continue
      }

      if (!res.ok) return null
      const contentType = res.headers.get('content-type') ?? ''
      if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
        return null
      }

      const buf = await res.arrayBuffer()
      const raw = Buffer.from(buf).subarray(0, maxBytes).toString('utf8')
      const text = htmlToText(raw)
      return text.length > 0 ? text : null
    }
    return null // too many redirects
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Strips scripts/styles/tags and collapses whitespace into readable text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}
