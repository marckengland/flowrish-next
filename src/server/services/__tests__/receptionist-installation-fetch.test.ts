// @vitest-environment node
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { RequestOptions } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { lookup, request } = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup }))
vi.mock('node:https', () => ({ request }))
import { fetchInstallationPage, isPublicInstallationAddress } from '../receptionist-installation-fetch'
const site = 'https://customer.example.com/', allowed = [new URL(site).origin, 'https://www.customer.example.com']
type ResponsePlan = { status?: number; headers?: Partial<Record<string, string>>; chunks?: Array<string | Buffer>; hang?: boolean; error?: boolean }
let plans: ResponsePlan[], requests: Array<EventEmitter & { end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>
beforeEach(() => {
  lookup.mockReset(); request.mockReset(); lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]); plans = [{}]; requests = []
  request.mockImplementation((_url: URL, _options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const plan = plans.shift() ?? {}, req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() }); requests.push(req)
    req.end.mockImplementation(() => { queueMicrotask(() => { if (plan.error) { req.emit('error', new Error('PRIVATE NETWORK DIAGNOSTIC')); return } const response = plan.hang ? new Readable({ read() {} }) : Readable.from(plan.chunks ?? ['<html>Public page</html>']); Object.assign(response, { statusCode: plan.status ?? 200, headers: { 'content-type': 'text/html; charset=utf-8', ...plan.headers } }); callback(response as IncomingMessage) }) }); return req
  })
})
afterEach(() => { vi.useRealTimers() })
describe('bounded public website transport without real network traffic', () => {
  it('permits global addresses and rejects private, special, mapped, tunnel and metadata ranges', () => {
    for (const value of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isPublicInstallationAddress(value)).toBe(true)
    for (const value of ['0.1.2.3', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.1.1', '192.168.1.1', '100.100.100.200', '192.0.0.192', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.1.1.1', '240.0.0.1', '168.63.129.16', '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fc00::1', 'fe80::1', 'ff02::1', '64:ff9b::a00:1', '2001:db8::1', '2001::1', '2002:7f00:1::', '3fff::1', 'not-an-ip']) expect(isPublicInstallationAddress(value)).toBe(false)
  })
  it('pins the validated address while preserving hostname TLS/SNI and sending no credentials', async () => {
    lookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]).mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    const result = await fetchInstallationPage(site, allowed); expect(result).toMatchObject({ outcome: 'html', url: site, html: '<html>Public page</html>' }); const options = request.mock.calls[0][1] as RequestOptions; const connected: unknown[] = []
    options.lookup!('customer.example.com', {}, (error, address, family) => { connected.push(error, address, family) }); expect(connected).toEqual([null, '8.8.8.8', 4]); expect(lookup).toHaveBeenCalledOnce(); expect(options.servername).toBe('customer.example.com'); expect(options.agent).toBe(false); expect(options.headers).toMatchObject({ 'accept-encoding': 'identity' }); expect(JSON.stringify(options.headers)).not.toMatch(/cookie|authorization|referer/i)
  })
  it('blocks unsafe URLs and disallowed origins before DNS, then rejects any private DNS answer before connecting', async () => {
    for (const url of ['https://127.0.0.1/', 'http://customer.example.com/', 'https://customer.example.com:8443/', 'https://other.example.com/']) expect((await fetchInstallationPage(url, allowed)).outcome).not.toBe('html')
    expect(lookup).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled()
    for (const addresses of [[{ address: '10.0.0.1', family: 4 }], [{ address: '8.8.8.8', family: 4 }, { address: '::ffff:7f00:1', family: 6 }]]) { lookup.mockResolvedValue(addresses); expect((await fetchInstallationPage(site, allowed)).outcome).toBe('blocked_destination') }
    expect(request).not.toHaveBeenCalled()
  })
  it('revalidates and pins each allowed redirect destination', async () => {
    plans = [{ status: 302, headers: { location: 'https://www.customer.example.com/home' } }, {}]; lookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]).mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }]); const result = await fetchInstallationPage(site, allowed); expect(result).toMatchObject({ outcome: 'html', url: 'https://www.customer.example.com/home' }); expect(lookup).toHaveBeenCalledTimes(2); expect(request).toHaveBeenCalledTimes(2); expect(request.mock.calls[1][1].servername).toBe('www.customer.example.com')
  })
  it('never follows an unsaved, credentialed, queried, insecure or private redirect', async () => {
    for (const location of ['https://other.example.com/', 'https://127.0.0.1/', 'https://user:pass@customer.example.com/', 'http://customer.example.com/', 'https://customer.example.com/?token=PRIVATE']) { plans = [{ status: 302, headers: { location } }]; request.mockClear(); lookup.mockClear(); const result = await fetchInstallationPage(site, allowed); expect(result.outcome).not.toBe('html'); expect(lookup).toHaveBeenCalledOnce(); expect(request).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).not.toMatch(/PRIVATE|user:pass|127\.0\.0\.1/) }
  })
  it('bounds redirects and refuses oversized, compressed, non-HTML and error responses', async () => {
    plans = Array.from({ length: 4 }, () => ({ status: 302, headers: { location: '/next' } })); expect((await fetchInstallationPage(site, allowed)).outcome).toBe('redirect_limit'); expect(request).toHaveBeenCalledTimes(4)
    for (const plan of [{ headers: { 'content-length': '524289' } }, { chunks: [Buffer.alloc(300000), Buffer.alloc(300000)] }]) { plans = [plan]; expect((await fetchInstallationPage(site, allowed)).outcome).toBe('page_too_large') }
    for (const plan of [{ headers: { 'content-encoding': 'gzip' } }, { headers: { 'content-type': 'application/json' } }, { status: 503 }, { status: 304 }, { error: true }]) { plans = [plan]; const result = await fetchInstallationPage(site, allowed); expect(result.outcome).not.toBe('html'); expect(JSON.stringify(result)).not.toContain('PRIVATE') }
    expect(requests.every(req => req.destroy.mock.calls.length > 0)).toBe(true)
  })
  it('applies one total deadline to stalled DNS and stalled responses', async () => {
    vi.useFakeTimers(); lookup.mockImplementationOnce(() => new Promise(() => {})); const dns = fetchInstallationPage(site, allowed); await vi.advanceTimersByTimeAsync(8000); expect((await dns).outcome).toBe('timed_out'); expect(request).not.toHaveBeenCalled()
    plans = [{ hang: true }]; const response = fetchInstallationPage(site, allowed); await vi.advanceTimersByTimeAsync(8000); expect((await response).outcome).toBe('timed_out'); expect(requests[0].destroy).toHaveBeenCalled()
  })
  it('honors client cancellation and does not send a request for a pre-aborted check', async () => {
    const canceled = new AbortController(); canceled.abort(); expect((await fetchInstallationPage(site, allowed, canceled.signal)).outcome).not.toBe('html'); expect(lookup).not.toHaveBeenCalled()
    plans = [{ hang: true }]; const active = new AbortController(), result = fetchInstallationPage(site, allowed, active.signal); await new Promise(resolve => setTimeout(resolve, 0)); active.abort(); expect((await result).outcome).not.toBe('html'); expect(requests[0].destroy).toHaveBeenCalled()
  })
})
