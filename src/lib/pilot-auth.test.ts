import { expect, it } from 'vitest'
import { safeAuthNext } from './pilot-onboarding'
it.each([
  'https://untrusted.example',
  '//untrusted.example',
  '/\\untrusted.example',
  '/\n/untrusted.example',
  'javascript:alert(1)',
  undefined,
])('rejects unsafe auth continuation %j', (next) => {
  expect(safeAuthNext(next)).toBe('/dashboard')
})
it.each(['/dashboard', '/receptionist/setup', '/leads?sort=recent'])(
  'preserves local continuation %s',
  (next) => {
    expect(safeAuthNext(next)).toBe(next)
  },
)
