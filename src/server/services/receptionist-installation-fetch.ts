import 'server-only'
import { lookup } from 'node:dns/promises'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { BlockList, isIP } from 'node:net'
import { installationPageUrl, type InstallationOutcome } from '@/lib/receptionist-installation'

const denied = new BlockList(), globalV6 = new BlockList()
for (const [address, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) denied.addSubnet(address, bits, 'ipv4')
denied.addAddress('168.63.129.16', 'ipv4')
globalV6.addSubnet('2000::', 3, 'ipv6')
for (const [address, bits] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) denied.addSubnet(address, bits, 'ipv6')
export function isPublicInstallationAddress(address: string) {
  const kind = isIP(address)
  if (!kind || address.includes('%')) return false
  return kind === 4 ? !denied.check(address, 'ipv4') : globalV6.check(address, 'ipv6') && !denied.check(address, 'ipv6')
}
type Failure = Exclude<InstallationOutcome, 'snippet_found' | 'snippet_missing' | 'wrong_widget' | 'wrong_source' | 'multiple_snippets' | 'unsupported_snippet'>
export type InstallationFetchResult = { outcome: 'html'; url: string; html: string } | { outcome: Failure; url: string | null }
type Hop = { outcome: 'html'; html: string } | { outcome: 'redirect'; location: string } | { outcome: Failure }
async function addresses(hostname: string, signal: AbortSignal) {
  return new Promise<Array<{ address: string; family: number }> | null>(resolve => {
    const done = (value: Array<{ address: string; family: number }> | null) => { signal.removeEventListener('abort', canceled); resolve(value) }, canceled = () => { done(null) }
    if (signal.aborted) { done(null); return }
    signal.addEventListener('abort', canceled, { once: true })
    lookup(hostname, { all: true, verbatim: true }).then(done, () => { done(null) })
  })
}
function readHop(url: URL, pin: { address: string; family: number }, signal: AbortSignal): Promise<Hop> {
  return new Promise(resolve => {
    let finished = false, response: IncomingMessage | undefined
    const done = (value: Hop) => { if (finished) return; finished = true; signal.removeEventListener('abort', canceled); response?.destroy(); req.destroy(); resolve(value) }
    const canceled = () => { done({ outcome: 'timed_out' }) }
    const options: RequestOptions = {
      method: 'GET', agent: false, family: pin.family, servername: url.hostname, rejectUnauthorized: true, maxHeaderSize: 16384,
      headers: { host: url.host, accept: 'text/html', 'accept-encoding': 'identity', 'user-agent': 'FlowrishInstallationChecker/1.0' },
      lookup: (hostname, _options, callback) => { if (hostname !== url.hostname) callback(new Error('Unverified hostname'), '', 4); else callback(null, pin.address, pin.family) },
    }
    const req = httpsRequest(url, options, res => {
      response = res
      res.on('error', () => { done({ outcome: 'fetch_failed' }) }); res.once('aborted', () => { done({ outcome: 'fetch_failed' }) }); res.once('close', () => { if (!finished) done({ outcome: 'fetch_failed' }) })
      const status = res.statusCode ?? 0
      if ([301, 302, 303, 307, 308].includes(status)) { const location = res.headers.location; done(typeof location === 'string' && location ? { outcome: 'redirect', location } : { outcome: 'fetch_failed' }); return }
      if (status < 200 || status >= 300) { done({ outcome: 'fetch_failed' }); return }
      const mime = res.headers['content-type'], encoding = res.headers['content-encoding'], length = res.headers['content-length']
      if (typeof mime !== 'string' || !/^text\/html(?:\s*;|$)/i.test(mime.trim()) || encoding !== undefined && (typeof encoding !== 'string' || encoding.trim().toLowerCase() !== 'identity')) { done({ outcome: 'unsupported_page' }); return }
      if (typeof length === 'string' && Number(length) > 524288) { done({ outcome: 'page_too_large' }); return }
      const chunks: Buffer[] = []; let size = 0
      res.on('data', (value: Buffer | string) => { if (finished) return; const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value); size += chunk.length; if (size > 524288) { done({ outcome: 'page_too_large' }); return } chunks.push(chunk) })
      res.once('end', () => { done({ outcome: 'html', html: Buffer.concat(chunks, size).toString('utf8') }) })
    })
    req.on('error', () => { done({ outcome: signal.aborted ? 'timed_out' : 'fetch_failed' }) }); req.once('close', () => { if (!finished && !response) done({ outcome: 'fetch_failed' }) })
    signal.addEventListener('abort', canceled, { once: true })
    if (signal.aborted) canceled(); else req.end()
  })
}
/** No automatic redirects or second DNS lookup: each connection uses its validated pin. */
export async function fetchInstallationPage(raw: string, allowedOrigins: string[], parent?: AbortSignal): Promise<InstallationFetchResult> {
  const deadline = new AbortController(), signal = parent ? AbortSignal.any([parent, deadline.signal]) : deadline.signal
  const timer = setTimeout(() => { deadline.abort() }, 8000); timer.unref()
  let current = raw, lastUrl: string | null = null
  try {
    for (let hop = 0; hop <= 3; hop++) {
      if (signal.aborted) return { outcome: 'timed_out', url: lastUrl }
      const parsed = installationPageUrl.safeParse(current)
      if (!parsed.success) return { outcome: 'blocked_destination', url: lastUrl }
      const url = new URL(parsed.data)
      if (!allowedOrigins.includes(url.origin)) return { outcome: hop === 0 ? 'origin_not_allowed' : 'redirect_not_allowed', url: lastUrl }
      lastUrl = url.href
      const found = await addresses(url.hostname, signal)
      if (signal.aborted) return { outcome: 'timed_out', url: lastUrl }
      if (!found?.length || found.length > 32) return { outcome: 'fetch_failed', url: lastUrl }
      if (!found.every(row => isIP(row.address) === row.family && isPublicInstallationAddress(row.address))) return { outcome: 'blocked_destination', url: lastUrl }
      const response = await readHop(url, found[0], signal)
      if (response.outcome === 'html') return { ...response, url: lastUrl }
      if (response.outcome !== 'redirect') return { ...response, url: lastUrl }
      if (hop === 3) return { outcome: 'redirect_limit', url: lastUrl }
      try { current = new URL(response.location, url).href } catch { return { outcome: 'blocked_destination', url: lastUrl } }
    }
    return { outcome: 'redirect_limit', url: lastUrl }
  } catch { return { outcome: signal.aborted ? 'timed_out' : 'fetch_failed', url: lastUrl } }
  finally { clearTimeout(timer) }
}
