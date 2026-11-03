import { z } from 'zod'

export const installationPageUrl = z.string().trim().max(2000).transform((value, ctx) => {
  try {
    const url = new URL(value), labels = url.hostname.split('.')
    if (url.href.length > 2000 || url.protocol !== 'https:' || url.port || url.username || url.password || value.includes('?') || value.includes('#') || labels.length < 2 || url.hostname.length > 253 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) || !/[a-z]/i.test(labels.at(-1)!) || /\.(?:localhost|local|internal|lan|home|invalid|test|onion)$/i.test(url.hostname)) throw new Error()
    return url.href
  } catch { ctx.addIssue({ code: 'custom', message: 'Use a public HTTPS page URL without credentials, a query, a fragment, or a custom port.' }); return z.NEVER }
})
export const installationInputSchema = z.object({ url: installationPageUrl, expectedUpdatedAt: z.string().datetime() }).strict()
export const installationOutcome = z.enum(['snippet_found', 'snippet_missing', 'wrong_widget', 'wrong_source', 'multiple_snippets', 'unsupported_snippet', 'origin_not_allowed', 'redirect_not_allowed', 'fetch_failed', 'unsupported_page', 'page_too_large', 'timed_out', 'blocked_destination', 'redirect_limit'])
export type InstallationOutcome = z.infer<typeof installationOutcome>
export const installationResultSchema = z.object({ requestedUrl: installationPageUrl, checkedUrl: installationPageUrl.nullable(), checkedAt: z.string().datetime(), expectedUpdatedAt: z.string().datetime(), publicId: z.string().uuid(), originAllowed: z.boolean(), outcome: installationOutcome, matchingSnippets: z.number().int().min(0).max(100), detectedSnippets: z.number().int().min(0).max(100) }).strict().superRefine((value, ctx) => {
  if (value.matchingSnippets > value.detectedSnippets || value.outcome === 'snippet_found' && (!value.originAllowed || !value.checkedUrl || value.matchingSnippets !== 1 || value.detectedSnippets !== 1) || value.outcome === 'origin_not_allowed' && value.originAllowed) ctx.addIssue({ code: 'custom', message: 'Inconsistent installation result.' })
})
export type InstallationResult = z.infer<typeof installationResultSchema>
export const installationGuidance: Record<InstallationOutcome, { title: string; detail: string }> = {
  snippet_found: { title: 'Matching snippet found in page source', detail: 'The standard script source and saved widget ID match. This does not test browser execution, CSP, AI connectivity, or a conversation.' },
  snippet_missing: { title: 'Snippet not found in page source', detail: 'Copy the supplied snippet into this page and publish the website. Tag managers and JavaScript-only injection need a manual browser check.' },
  wrong_widget: { title: 'The widget ID does not match', detail: 'Replace the website snippet with the current snippet from this setup. Do not reuse another organization’s widget ID.' },
  wrong_source: { title: 'The script source does not match', detail: 'Use the supplied absolute HTTPS script URL. A different host, relative URL, or copied script file is not the standard installation.' },
  multiple_snippets: { title: 'Multiple receptionist snippets found', detail: 'Keep one current snippet on this page. Remove duplicate or conflicting installations, publish, and check again.' },
  unsupported_snippet: { title: 'Use the standard script tag', detail: 'Use the supplied classic script tag. Module, nomodule, and non-JavaScript variants cannot be confirmed by this checker.' },
  origin_not_allowed: { title: 'This website is not in the saved allowed list', detail: 'Save this exact HTTPS website origin in Websites and limits, reload saved setup, then check again. Subdomains need their own entry.' },
  redirect_not_allowed: { title: 'The page redirects outside the saved websites', detail: 'Review the website’s redirect, save the destination’s exact origin if appropriate, then check its public URL directly.' },
  fetch_failed: { title: 'The public page could not be read', detail: 'Check the public URL, HTTPS certificate, and website availability. Password protection, bot blocking, and error pages need a manual check.' },
  unsupported_page: { title: 'Page source could not be safely checked', detail: 'Use a public HTML page with the standard snippet. Compressed, malformed, unusually complex, or non-HTML responses need a manual browser check.' },
  page_too_large: { title: 'The page exceeds the source-check limit', detail: 'This checker reads at most 512 KiB. Use a smaller public page with the snippet or check the installation manually.' },
  timed_out: { title: 'The website check timed out', detail: 'The check stops after eight seconds. Try again later or verify the snippet manually.' },
  blocked_destination: { title: 'This destination cannot be checked', detail: 'Only public website destinations are supported. Private, local, reserved, and mixed public/private DNS destinations are blocked.' },
  redirect_limit: { title: 'The page redirects too many times', detail: 'Use the final public page URL directly. The checker follows at most three redirects between saved allowed websites.' },
}

type Inspection = Pick<InstallationResult, 'outcome' | 'matchingSnippets' | 'detectedSnippets'>
const empty = (outcome: InstallationOutcome): Inspection => ({ outcome, matchingSnippets: 0, detectedSnippets: 0 })
function decodeAttribute(value: string) {
  const names: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (raw, entity: string) => { if (!entity.startsWith('#')) return names[entity.toLowerCase()]; const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10); return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : raw })
}
function tagEnd(html: string, start: number) {
  let quote = ''
  for (let n = start; n < html.length; n++) { const c = html[n]; if (quote) { if (c === quote) quote = '' } else if (c === '"' || c === "'") quote = c; else if (c === '>') return n }
  return -1
}
function attributes(source: string): Map<string, string> | null {
  const result = new Map<string, string>(); let n = 0, count = 0
  while (n < source.length) {
    while (/[\t\n\f\r ]/.test(source[n] ?? '') && n < source.length) n++
    if (n === source.length || source[n] === '/' && n === source.length - 1) break
    if (++count > 256) return null
    const name = /^[^\t\n\f\r /=>"'<`]+/.exec(source.slice(n))?.[0]; if (!name) return null; n += name.length
    while (/[\t\n\f\r ]/.test(source[n] ?? '') && n < source.length) n++
    let value = ''
    if (source[n] === '=') {
      n++; while (/[\t\n\f\r ]/.test(source[n] ?? '') && n < source.length) n++
      const quote = source[n]
      if (quote === '"' || quote === "'") { const end = source.indexOf(quote, n + 1); if (end < 0) return null; value = source.slice(n + 1, end); n = end + 1 }
      else { const raw = /^[^\t\n\f\r >"'<`=]+/.exec(source.slice(n))?.[0]; if (!raw) return null; value = raw; n += raw.length }
    }
    if (!result.has(name.toLowerCase())) result.set(name.toLowerCase(), decodeAttribute(value))
  }
  return result
}
/** A bounded scanner for the standard classic tag; it does not execute or render HTML. */
export function inspectInstallationSource(html: string, publicId: string, appOrigin: string): Inspection {
  if (html.includes('\0')) return empty('unsupported_page')
  if (html.length > 524288 || new TextEncoder().encode(html).length > 524288) return empty('page_too_large')
  const scripts: Array<Map<string, string>> = [], inert: string[] = []; let offset = 0, tokens = 0
  while (offset < html.length) {
    const start = html.indexOf('<', offset); if (start < 0) break
    if (++tokens > 20000) return empty('unsupported_page')
    if (html.startsWith('<!--', start)) { const end = html.indexOf('-->', start + 4); if (end < 0) return empty('unsupported_page'); offset = end + 3; continue }
    const end = tagEnd(html, start + 1); if (end < 0) return empty('unsupported_page')
    const raw = html.slice(start + 1, end), match = /^(\/?)([a-z][a-z0-9:-]*)(?=[\t\n\f\r /]|$)/i.exec(raw); offset = end + 1
    if (!match) continue
    const name = match[2].toLowerCase(), closing = !!match[1]
    if (['template', 'noscript', 'svg', 'math'].includes(name)) { if (!closing) inert.push(name); else if (inert.at(-1) === name) inert.pop(); else return empty('unsupported_page'); continue }
    if (!closing && name === 'frameset' && !inert.length) return empty('unsupported_page')
    if (closing) continue
    if (name === 'plaintext') break
    if (name === 'script') {
      const attrs = attributes(raw.slice(match[0].length)); if (!attrs) return empty('unsupported_page')
      if (!inert.length && (attrs.has('data-flowrish-receptionist') || /receptionist-widget\.js/i.test(attrs.get('src') ?? ''))) { scripts.push(attrs); if (scripts.length > 100) return empty('unsupported_page') }
    }
    if (['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes'].includes(name)) {
      const close = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, 'ig'); close.lastIndex = offset; const found = close.exec(html)
      if (!found) return empty('unsupported_page')
      const afterName = found.index + found[0].length, closeEnd = tagEnd(html, afterName)
      if (closeEnd < 0 || !/^[\t\n\f\r ]*$/.test(html.slice(afterName, closeEnd))) return empty('unsupported_page')
      const body = html.slice(offset, found.index)
      if (name === 'script' && body.includes('<!--') && /<script[\t\n\f\r />]/i.test(body)) return empty('unsupported_page')
      offset = closeEnd + 1
    }
  }
  if (inert.length) return empty('unsupported_page')
  if (!scripts.length) return empty('snippet_missing')
  const matchesSource = (attrs: Map<string, string>) => { try { const raw = (attrs.get('src') ?? '').replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, ''), url = new URL(raw); return /^https:\/\//i.test(raw) && !url.username && !url.password && url.origin === new URL(appOrigin).origin && url.pathname === '/receptionist-widget.js' } catch { return false } }
  const classic = (attrs: Map<string, string>) => { const type = (attrs.get('type') ?? '').replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '').toLowerCase(); const language = (attrs.get('language') ?? '').toLowerCase(); return !attrs.has('nomodule') && ['', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(type) && (attrs.has('type') || ['', 'javascript', 'ecmascript'].includes(language)) }
  const matchingSnippets = scripts.filter(attrs => classic(attrs) && matchesSource(attrs) && attrs.get('data-flowrish-receptionist') === publicId).length
  const first = scripts[0], outcome: InstallationOutcome = scripts.length > 1 ? 'multiple_snippets' : !classic(first) ? 'unsupported_snippet' : first.get('data-flowrish-receptionist') !== publicId ? 'wrong_widget' : !matchesSource(first) ? 'wrong_source' : 'snippet_found'
  return { outcome, matchingSnippets, detectedSnippets: scripts.length }
}
