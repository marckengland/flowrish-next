import { describe, it, expect } from 'vitest'
import { leadCreateSchema, leadUpdateSchema } from '../leads'

describe('leadCreateSchema', () => {
  const validLead = {
    firstName: 'John',
    lastName: 'Doe',
    stageId: '550e8400-e29b-41d4-a716-446655440000',
  }

  it('accepts valid minimal lead data', () => {
    const result = leadCreateSchema.parse(validLead)
    expect(result.firstName).toBe('John')
    expect(result.lastName).toBe('Doe')
    expect(result.stageId).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(result.currency).toBe('USD')
  })

  it('accepts full lead data', () => {
    const fullLead = {
      ...validLead,
      email: 'john@example.com',
      phone: '+1234567890',
      title: 'VP Sales',
      description: 'A great lead',
      dealValue: 50000,
      currency: 'EUR',
      score: 75,
      leadStatus: 'QUALIFIED',
      tier: 'TIER_1',
      linkedinUrl: 'https://linkedin.com/in/johndoe',
      country: 'US',
      state: 'CA',
      companyName: 'Acme Corp',
      companyIndustry: 'Technology',
      companyWebsite: 'https://acme.com',
    }
    const result = leadCreateSchema.parse(fullLead)
    expect(result.email).toBe('john@example.com')
    expect(result.dealValue).toBe(50000)
    expect(result.currency).toBe('EUR')
  })

  it('rejects missing firstName', () => {
    expect(() => leadCreateSchema.parse({ lastName: 'Doe', stageId: validLead.stageId })).toThrow()
  })

  it('rejects missing lastName', () => {
    expect(() => leadCreateSchema.parse({ firstName: 'John', stageId: validLead.stageId })).toThrow()
  })

  it('rejects missing stageId', () => {
    expect(() => leadCreateSchema.parse({ firstName: 'John', lastName: 'Doe' })).toThrow()
  })

  it('rejects invalid stageId format', () => {
    expect(() => leadCreateSchema.parse({ ...validLead, stageId: 'not-a-uuid' })).toThrow()
  })

  it('rejects invalid email format', () => {
    expect(() => leadCreateSchema.parse({ ...validLead, email: 'not-an-email' })).toThrow()
  })

  it('rejects negative deal value', () => {
    expect(() => leadCreateSchema.parse({ ...validLead, dealValue: -100 })).toThrow()
  })

  it('rejects score above 100', () => {
    expect(() => leadCreateSchema.parse({ ...validLead, score: 101 })).toThrow()
  })

  it('rejects score below 0', () => {
    expect(() => leadCreateSchema.parse({ ...validLead, score: -1 })).toThrow()
  })

  it('strips null bytes from firstName', () => {
    const result = leadCreateSchema.parse({ ...validLead, firstName: 'Jo\0hn' })
    expect(result.firstName).toBe('John')
  })

  it('rejects path traversal in firstName', () => {
    expect(() => leadCreateSchema.parse({ ...validLead, firstName: '../admin' })).toThrow()
  })

  it('rejects invalid leadStatus', () => {
    expect(() => leadCreateSchema.parse({ ...validLead, leadStatus: 'INVALID' })).toThrow()
  })

  it('rejects invalid tier', () => {
    expect(() => leadCreateSchema.parse({ ...validLead, tier: 'INVALID' })).toThrow()
  })
})

describe('leadUpdateSchema', () => {
  it('accepts empty object (no fields to update)', () => {
    const result = leadUpdateSchema.parse({})
    expect(result).toBeDefined()
  })

  it('accepts partial updates', () => {
    const result = leadUpdateSchema.parse({ firstName: 'Jane', dealValue: 75000 })
    expect(result.firstName).toBe('Jane')
    expect(result.dealValue).toBe(75000)
  })

  it('rejects invalid email on update', () => {
    expect(() => leadUpdateSchema.parse({ email: 'bad-email' })).toThrow()
  })

  it('strips null bytes from updated fields', () => {
    const result = leadUpdateSchema.parse({ firstName: 'Ja\0ne' })
    expect(result.firstName).toBe('Jane')
  })
})
