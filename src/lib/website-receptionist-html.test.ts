import { describe, expect, it } from 'vitest'
import { renderWebsiteReceptionistHtml } from './website-receptionist-html'

const data = {
  publicId: '550e8400-e29b-41d4-a716-446655440000',
  siteOrigin: 'https://customer.example',
  allowedOrigins: ['https://customer.example'],
  businessName: '</script><script>alert("business")</script> & \u2028\u2029',
}
const nonce = '0123456789abcdef0123456789abcdef'

describe('public receptionist HTML', () => {
  it('keeps business text inside JSON and nonces all executable assets', () => {
    const html = renderWebsiteReceptionistHtml(data, nonce)
    const document = new DOMParser().parseFromString(html, 'text/html')
    const scripts = [...document.scripts]
    expect(scripts).toHaveLength(2)
    expect(scripts[0].type).toBe('application/json')
    expect(JSON.parse(scripts[0].textContent!)).toEqual(data)
    expect(scripts[1].getAttribute('src')).toBe('/receptionist-widget-frame.js')
    expect(scripts.every(script => script.getAttribute('nonce') === nonce)).toBe(true)
    expect(document.querySelector('style')!.getAttribute('nonce')).toBe(nonce)
    expect(html).not.toContain(data.businessName)
    expect(document.querySelector('iframe')).toBeNull()
    expect(document.querySelector('input[type="checkbox"]')).not.toBeNull()
    expect(document.querySelector('input[name="website"]')!.getAttribute('tabindex')).toBe('-1')
  })

  it.each([
    { ...data, publicId: '" onload="alert(1)' },
    { ...data, siteOrigin: 'https://evil.example' },
    { ...data, allowedOrigins: ['https://customer.example/path'] },
    { ...data, businessName: '' },
  ])('rejects untrusted or mismatched embed configuration', value => {
    expect(() => renderWebsiteReceptionistHtml(value, nonce)).toThrow()
  })

  it('rejects an injectable CSP nonce', () => {
    expect(() => renderWebsiteReceptionistHtml(data, '" onload="alert(1)')).toThrow()
  })
})
