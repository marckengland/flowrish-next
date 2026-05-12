import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn utility', () => {
  it('merges class names correctly', () => {
    const result = cn('px-2', 'py-1')
    expect(result).toBe('px-2 py-1')
  })

  it('handles conditional classes', () => {
    const result = cn('base', false && 'hidden', 'visible')
    expect(result).toBe('base visible')
  })

  it('merges conflicting tailwind classes', () => {
    const result = cn('px-2', 'px-4')
    expect(result).toBe('px-4')
  })
})
