import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { cn } from '@/lib/utils'

describe('cn utility - property tests', () => {
  it('always returns a string', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.string(), fc.constant(undefined), fc.constant(false))),
        (inputs) => {
          const result = cn(...inputs)
          expect(typeof result).toBe('string')
        }
      )
    )
  })

  it('single class input returns that class', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9-]*$/),
        (className) => {
          const result = cn(className)
          expect(result).toBe(className)
        }
      )
    )
  })
})
