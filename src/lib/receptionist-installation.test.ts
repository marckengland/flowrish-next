import { describe, expect, it } from 'vitest'
import { inspectInstallationSource, installationInputSchema } from './receptionist-installation'
const id = '11111111-1111-4111-8111-111111111111', app = 'https://flowrish.example.com', tag = `<script src="${app}/receptionist-widget.js" data-flowrish-receptionist="${id}" defer></script>`
const inspect = (html: string) => inspectInstallationSource(html, id, app)
describe('standard receptionist installation source', () => {
  it('finds one active classic snippet with quoted, unquoted and case-insensitive attributes', () => {
    for (const html of [tag, `<!doctype html><html><body>${tag}</body></html>`, `<SCRIPT SRC='${app}/receptionist-widget.js?v=2' DATA-FLOWRISH-RECEPTIONIST=${id} defer></SCRIPT>`]) expect(inspect(html)).toEqual({ outcome: 'snippet_found', matchingSnippets: 1, detectedSnippets: 1 })
  })
  it('ignores comments, encoded examples, inline strings and inert/foreign content', () => {
    for (const html of [`<!--${tag}-->`, tag.replaceAll('<', '&lt;'), `<script>const example = ${JSON.stringify(tag)};</script>`, `<template>${tag}</template>`, `<noscript>${tag}</noscript>`, `<textarea>${tag}</textarea>`, `<style>${tag}</style>`, `<svg>${tag}</svg>`, `<iframe>${tag}</iframe>`]) expect(inspect(html).outcome).toBe('snippet_missing')
    expect(inspect(`<!-- ${tag} -->${tag}`).outcome).toBe('snippet_found')
  })
  it('does not mistake another widget or an attacker source for the saved snippet', () => {
    expect(inspect(tag.replace(id, '22222222-2222-4222-8222-222222222222')).outcome).toBe('wrong_widget')
    for (const source of ['https://evil.example.com/receptionist-widget.js', `${app}.evil.example.com/receptionist-widget.js`, '/receptionist-widget.js', `${app}/wrong.js`, `https://user:password@flowrish.example.com/receptionist-widget.js`]) expect(inspect(tag.replace(`${app}/receptionist-widget.js`, source)).outcome).toBe('wrong_source')
  })
  it('reports conflicting and duplicate snippets rather than claiming installation is correct', () => {
    expect(inspect(tag + tag)).toEqual({ outcome: 'multiple_snippets', matchingSnippets: 2, detectedSnippets: 2 })
    expect(inspect(tag + tag.replace(id, '22222222-2222-4222-8222-222222222222'))).toMatchObject({ outcome: 'multiple_snippets', matchingSnippets: 1, detectedSnippets: 2 })
  })
  it('uses first duplicate attribute values and decodes common/numeric HTML entities', () => {
    expect(inspect(tag.replace(' src=', ` src="https://evil.example.com/receptionist-widget.js" src=`)).outcome).toBe('wrong_source')
    expect(inspect(tag.replace(id, id.replaceAll('-', '&#45;'))).outcome).toBe('snippet_found')
    expect(inspect(tag.replace('defer', `title="a > b" defer`)).outcome).toBe('snippet_found')
  })
  it('rejects non-executing and module variants, malformed or incomplete sources', () => {
    for (const attr of ['type="module"', 'type="application/json"', 'nomodule']) expect(inspect(tag.replace('defer', attr)).outcome).toBe('unsupported_snippet')
    for (const html of [tag.slice(0, -9), `<script src="${app}/receptionist-widget.js data-flowrish-receptionist="${id}>`, tag + '<!-- unclosed']) expect(inspect(html).outcome).toBe('unsupported_page')
    expect(inspect('x'.repeat(524289)).outcome).toBe('page_too_large')
  })
  it('does not accept text that resembles an HTML tag or non-ASCII separators and legacy non-JavaScript language', () => {
    for (const html of [tag.replace('<script', '< script'), tag.replace('<script ', '<script\u00a0'), tag.replace('defer', 'language="python"'), tag.replace('defer', 'type="\u00a0text/javascript"')]) expect(inspect(html).outcome).not.toBe('snippet_found')
  })
  it('bounds normalized URLs and refuses ambiguous double-escaped script parsing', () => {
    expect(installationInputSchema.safeParse({ url: `https://customer.example.com/${'😀'.repeat(250)}`, expectedUpdatedAt: '2026-11-03T00:00:00.000Z' }).success).toBe(false)
    expect(inspect(`<script><!--<script></script>${tag}--></script>`).outcome).not.toBe('snippet_found')
    expect(inspect(tag.replace('</script>', '</script\u00a0>')).outcome).not.toBe('snippet_found')
  })
  it('fails closed on browser-recognized nonstandard script endings instead of hiding duplicates', () => {
    for (const close of ['</script x>', '</script/>']) { const html = tag.replace('</script>', close) + tag; const parsed = new DOMParser().parseFromString(html, 'text/html'); expect(parsed.querySelectorAll('script[src]')).toHaveLength(2); expect(inspect(html).outcome).toBe('unsupported_page') }
  })
  it('does not report scripts that the browser ignores in a frameset document', () => {
    const html = `<html><frameset>${tag}</frameset></html>`; expect(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('script')).toHaveLength(0); expect(inspect(html).outcome).toBe('unsupported_page')
  })
  it('bounds script attribute work on a page below the byte limit', () => {
    const html = `<script${' a'.repeat(100000)} src="${app}/receptionist-widget.js" data-flowrish-receptionist="${id}"${' '.repeat(250000)}></script>`; expect(html.length).toBeLessThan(524288); expect(inspect(html).outcome).toBe('unsupported_page')
  })
  it('accepts public HTTPS page paths but rejects credentials, queries, fragments, IPs and nonstandard ports', () => {
    const version = '2026-11-03T00:00:00.000Z'
    expect(installationInputSchema.parse({ url: 'https://customer.example.com/services', expectedUpdatedAt: version }).url).toBe('https://customer.example.com/services')
    for (const url of ['http://customer.example.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://user:pass@customer.example.com', 'https://customer.example.com?a=secret', 'https://customer.example.com/#fragment', 'https://customer.example.com:8443/', 'https://customer.example.com./', 'file:///etc/passwd']) expect(installationInputSchema.safeParse({ url, expectedUpdatedAt: version }).success).toBe(false)
    expect(installationInputSchema.safeParse({ url: 'https://customer.example.com', expectedUpdatedAt: version, organizationId: 'foreign' }).success).toBe(false)
  })
})
