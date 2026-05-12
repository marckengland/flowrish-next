import { describe, it, expect } from 'vitest'
import {
  cadenceCreateSchema,
  stepCreateSchema,
  enrollSchema,
  stepActionTypeEnum,
} from '../cadences'

describe('cadenceCreateSchema', () => {
  it('accepts valid cadence with name', () => {
    const result = cadenceCreateSchema.parse({ name: 'Outbound Sequence' })
    expect(result.name).toBe('Outbound Sequence')
  })

  it('accepts cadence with description', () => {
    const result = cadenceCreateSchema.parse({
      name: 'Follow-up',
      description: 'A multi-step follow-up cadence',
    })
    expect(result.name).toBe('Follow-up')
    expect(result.description).toBe('A multi-step follow-up cadence')
  })

  it('rejects empty name', () => {
    expect(() => cadenceCreateSchema.parse({ name: '' })).toThrow()
  })

  it('rejects name exceeding 200 characters', () => {
    expect(() => cadenceCreateSchema.parse({ name: 'a'.repeat(201) })).toThrow()
  })

  it('strips null bytes from name', () => {
    const result = cadenceCreateSchema.parse({ name: 'Test\0Cadence' })
    expect(result.name).toBe('TestCadence')
  })

  it('rejects path traversal in name', () => {
    expect(() => cadenceCreateSchema.parse({ name: '../secret' })).toThrow()
  })
})

describe('stepCreateSchema', () => {
  const validStep = {
    actionType: 'EMAIL' as const,
    stepOrder: 1,
    delayHours: 24,
  }

  it('accepts valid step', () => {
    const result = stepCreateSchema.parse(validStep)
    expect(result.actionType).toBe('EMAIL')
    expect(result.stepOrder).toBe(1)
    expect(result.delayHours).toBe(24)
  })

  it('accepts step with subject and body', () => {
    const result = stepCreateSchema.parse({
      ...validStep,
      subject: 'Follow up',
      body: 'Hi {{FirstName}}, just checking in.',
    })
    expect(result.subject).toBe('Follow up')
    expect(result.body).toBe('Hi {{FirstName}}, just checking in.')
  })

  it('rejects stepOrder less than 1', () => {
    expect(() => stepCreateSchema.parse({ ...validStep, stepOrder: 0 })).toThrow()
  })

  it('rejects negative delayHours', () => {
    expect(() => stepCreateSchema.parse({ ...validStep, delayHours: -1 })).toThrow()
  })

  it('rejects invalid actionType', () => {
    expect(() => stepCreateSchema.parse({ ...validStep, actionType: 'INVALID' })).toThrow()
  })

  it('accepts all valid action types', () => {
    for (const type of ['EMAIL', 'CALL', 'LINKEDIN', 'MANUAL_TASK']) {
      const result = stepCreateSchema.parse({ ...validStep, actionType: type })
      expect(result.actionType).toBe(type)
    }
  })
})

describe('enrollSchema', () => {
  it('accepts valid leadId', () => {
    const result = enrollSchema.parse({
      leadId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.leadId).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('rejects invalid leadId format', () => {
    expect(() => enrollSchema.parse({ leadId: 'not-a-uuid' })).toThrow()
  })

  it('rejects missing leadId', () => {
    expect(() => enrollSchema.parse({})).toThrow()
  })
})

describe('stepActionTypeEnum', () => {
  it('accepts all valid types', () => {
    expect(stepActionTypeEnum.parse('EMAIL')).toBe('EMAIL')
    expect(stepActionTypeEnum.parse('CALL')).toBe('CALL')
    expect(stepActionTypeEnum.parse('LINKEDIN')).toBe('LINKEDIN')
    expect(stepActionTypeEnum.parse('MANUAL_TASK')).toBe('MANUAL_TASK')
  })

  it('rejects invalid types', () => {
    expect(() => stepActionTypeEnum.parse('SMS')).toThrow()
  })
})
