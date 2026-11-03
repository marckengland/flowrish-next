import { expect, it } from 'vitest'
import { renderWebsiteReceptionistHtml } from './website-receptionist-html'
it('discloses lasting FAQ copies in the visitor review form before consent', () => {
  const html = renderWebsiteReceptionistHtml({ publicId: '11111111-1111-4111-8111-111111111111', businessName: 'Synthetic Repairs', siteOrigin: 'https://shop.example', allowedOrigins: ['https://shop.example'] }, '0123456789abcdef0123456789abcdef')
  const form = new DOMParser().parseFromString(html, 'text/html').getElementById('feedback-form')!
  expect(form.textContent).toContain('The business may copy your question into FAQs that remain after this report expires or is deleted.')
  expect(form.textContent).toContain('Remove personal details before agreeing.'); expect(form.querySelector<HTMLInputElement>('#feedback-consent')?.checked).toBe(false)
})
