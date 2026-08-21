import { describe, it, expect } from 'vitest'
import {
  sanitizedString,
  optionalSanitizedString,
  nullableSanitizedString,
  safeFileName,
  safeJsonBody,
  paginationSchema,
  hasPrototypePollution,
} from '../common'

describe('sanitizedString', () => {
  it('strips null bytes from input', () => {
    const result = sanitizedString.parse('hello\0world')
    expect(result).toBe('helloworld')
  })

  it('accepts text containing dot sequences (ellipses are legitimate prose)', () => {
    // These are free-text fields (names, subjects, bodies, notes). `..`
    // and `...` are normal writing, not path traversal. Traversal is
    // guarded by safeFileName at the upload boundary instead.
    expect(sanitizedString.parse('Wait.. then follow up')).toBe('Wait.. then follow up')
    expect(sanitizedString.parse('Hmm... let me think')).toBe('Hmm... let me think')
    expect(sanitizedString.parse('../etc/passwd')).toBe('../etc/passwd')
  })

  it('rejects strings exceeding 10000 characters', () => {
    const longString = 'a'.repeat(10001)
    expect(() => sanitizedString.parse(longString)).toThrow('String too long')
  })

  it('accepts valid strings', () => {
    expect(sanitizedString.parse('hello world')).toBe('hello world')
    expect(sanitizedString.parse('user@example.com')).toBe('user@example.com')
  })

  it('accepts strings with single dots', () => {
    expect(sanitizedString.parse('file.txt')).toBe('file.txt')
    expect(sanitizedString.parse('a.b.c')).toBe('a.b.c')
  })
})

describe('optionalSanitizedString', () => {
  it('allows undefined', () => {
    const result = optionalSanitizedString.parse(undefined)
    expect(result).toBeUndefined()
  })

  it('strips null bytes when present', () => {
    const result = optionalSanitizedString.parse('test\0value')
    expect(result).toBe('testvalue')
  })

  it('accepts text containing dot sequences', () => {
    expect(optionalSanitizedString.parse('a.. b')).toBe('a.. b')
  })
})

describe('nullableSanitizedString', () => {
  it('allows null', () => {
    const result = nullableSanitizedString.parse(null)
    expect(result).toBeNull()
  })

  it('allows undefined', () => {
    const result = nullableSanitizedString.parse(undefined)
    expect(result).toBeUndefined()
  })

  it('strips null bytes when present', () => {
    const result = nullableSanitizedString.parse('data\0here')
    expect(result).toBe('datahere')
  })
})

describe('safeFileName', () => {
  it('accepts normal filenames', () => {
    expect(safeFileName.parse('proposal.pdf')).toBe('proposal.pdf')
    expect(safeFileName.parse('Q3 Report (final).docx')).toBe('Q3 Report (final).docx')
  })

  it('strips null bytes', () => {
    expect(safeFileName.parse('re\0port.pdf')).toBe('report.pdf')
  })

  it('rejects path traversal sequences', () => {
    expect(() => safeFileName.parse('../etc/passwd')).toThrow('path traversal')
    expect(() => safeFileName.parse('..')).toThrow('path traversal')
  })

  it('rejects path separators', () => {
    expect(() => safeFileName.parse('folder/file.pdf')).toThrow('path separators')
    expect(() => safeFileName.parse('folder\\file.pdf')).toThrow('path separators')
  })

  it('rejects empty or whitespace-only names', () => {
    expect(() => safeFileName.parse('   ')).toThrow('Filename is required')
  })

  it('rejects filenames over 255 characters', () => {
    expect(() => safeFileName.parse('a'.repeat(256))).toThrow('Filename too long')
  })
})

describe('hasPrototypePollution', () => {
  it('detects __proto__ key from JSON-parsed objects', () => {
    const obj = JSON.parse('{"__proto__": {"isAdmin": true}}')
    expect(hasPrototypePollution(obj)).toBe(true)
  })

  it('detects constructor key', () => {
    expect(hasPrototypePollution({ constructor: {} })).toBe(true)
  })

  it('detects prototype key', () => {
    expect(hasPrototypePollution({ prototype: {} })).toBe(true)
  })

  it('detects nested pollution keys', () => {
    const nested = JSON.parse('{"nested": {"__proto__": {}}}')
    expect(hasPrototypePollution(nested)).toBe(true)
    expect(hasPrototypePollution({ a: { b: { constructor: {} } } })).toBe(true)
  })

  it('returns false for safe objects', () => {
    expect(hasPrototypePollution({ name: 'test', value: 123 })).toBe(false)
    expect(hasPrototypePollution({ nested: { safe: true } })).toBe(false)
  })

  it('handles non-object values', () => {
    expect(hasPrototypePollution(null)).toBe(false)
    expect(hasPrototypePollution('string')).toBe(false)
    expect(hasPrototypePollution(42)).toBe(false)
  })

  it('handles arrays with nested pollution', () => {
    const arr = [{ constructor: {} }]
    expect(hasPrototypePollution(arr)).toBe(true)
    expect(hasPrototypePollution([1, 2, 3])).toBe(false)
  })
})

describe('safeJsonBody', () => {
  it('accepts safe objects', () => {
    const result = safeJsonBody.parse({ name: 'test', value: 123 })
    expect(result).toEqual({ name: 'test', value: 123 })
  })

  it('rejects objects with __proto__', () => {
    const malicious = JSON.parse('{"__proto__": {"isAdmin": true}}')
    expect(() => safeJsonBody.parse(malicious)).toThrow('Invalid input')
  })

  it('rejects objects with constructor key', () => {
    const malicious = JSON.parse('{"constructor": {"prototype": {}}}')
    expect(() => safeJsonBody.parse(malicious)).toThrow('Invalid input')
  })

  it('rejects nested prototype pollution', () => {
    const malicious = JSON.parse('{"data": {"__proto__": {"polluted": true}}}')
    expect(() => safeJsonBody.parse(malicious)).toThrow('Invalid input')
  })
})

describe('paginationSchema', () => {
  it('provides defaults when no input given', () => {
    const result = paginationSchema.parse({})
    expect(result).toEqual({ page: 1, pageSize: 20 })
  })

  it('accepts valid page and pageSize', () => {
    const result = paginationSchema.parse({ page: 3, pageSize: 50 })
    expect(result).toEqual({ page: 3, pageSize: 50 })
  })

  it('coerces string values to numbers', () => {
    const result = paginationSchema.parse({ page: '2', pageSize: '10' })
    expect(result).toEqual({ page: 2, pageSize: 10 })
  })

  it('rejects page less than 1', () => {
    expect(() => paginationSchema.parse({ page: 0 })).toThrow()
  })

  it('rejects pageSize greater than 100', () => {
    expect(() => paginationSchema.parse({ pageSize: 101 })).toThrow()
  })

  it('rejects pageSize less than 1', () => {
    expect(() => paginationSchema.parse({ pageSize: 0 })).toThrow()
  })
})
