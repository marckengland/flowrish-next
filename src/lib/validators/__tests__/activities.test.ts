import { describe, it, expect } from 'vitest'
import { activityCreateSchema, activityTypeEnum } from '../activities'

describe('activityCreateSchema', () => {
  const validBase = {
    type: 'NOTE' as const,
    leadId: '550e8400-e29b-41d4-a716-446655440000',
  }

  it('accepts valid NOTE activity', () => {
    const result = activityCreateSchema.parse(validBase)
    expect(result.type).toBe('NOTE')
    expect(result.leadId).toBe(validBase.leadId)
  })

  it('accepts valid CALL activity with callDate', () => {
    const result = activityCreateSchema.parse({
      type: 'CALL',
      leadId: validBase.leadId,
      callDate: '2025-01-15T10:00:00Z',
      callDuration: 300,
    })
    expect(result.type).toBe('CALL')
    expect(result.callDate).toBeInstanceOf(Date)
    expect(result.callDuration).toBe(300)
  })

  it('rejects CALL activity without callDate', () => {
    expect(() =>
      activityCreateSchema.parse({
        type: 'CALL',
        leadId: validBase.leadId,
      })
    ).toThrow('callDate is required for CALL activities')
  })

  it('accepts valid MEETING activity with meetingDate', () => {
    const result = activityCreateSchema.parse({
      type: 'MEETING',
      leadId: validBase.leadId,
      meetingDate: '2025-02-01T14:00:00Z',
      attendees: ['Alice', 'Bob'],
    })
    expect(result.type).toBe('MEETING')
    expect(result.meetingDate).toBeInstanceOf(Date)
    expect(result.attendees).toEqual(['Alice', 'Bob'])
  })

  it('rejects MEETING activity without meetingDate', () => {
    expect(() =>
      activityCreateSchema.parse({
        type: 'MEETING',
        leadId: validBase.leadId,
      })
    ).toThrow('meetingDate is required for MEETING activities')
  })

  it('rejects invalid leadId format', () => {
    expect(() =>
      activityCreateSchema.parse({ type: 'NOTE', leadId: 'not-a-uuid' })
    ).toThrow()
  })

  it('rejects invalid activity type', () => {
    expect(() =>
      activityCreateSchema.parse({ type: 'INVALID', leadId: validBase.leadId })
    ).toThrow()
  })

  it('accepts EMAIL activity type', () => {
    const result = activityCreateSchema.parse({
      type: 'EMAIL',
      leadId: validBase.leadId,
    })
    expect(result.type).toBe('EMAIL')
  })

  it('accepts FILE_ATTACHMENT activity type', () => {
    const result = activityCreateSchema.parse({
      type: 'FILE_ATTACHMENT',
      leadId: validBase.leadId,
    })
    expect(result.type).toBe('FILE_ATTACHMENT')
  })

  it('rejects negative callDuration', () => {
    expect(() =>
      activityCreateSchema.parse({
        type: 'CALL',
        leadId: validBase.leadId,
        callDate: '2025-01-15T10:00:00Z',
        callDuration: -1,
      })
    ).toThrow()
  })
})

describe('activityTypeEnum', () => {
  it('accepts all valid types', () => {
    expect(activityTypeEnum.parse('CALL')).toBe('CALL')
    expect(activityTypeEnum.parse('MEETING')).toBe('MEETING')
    expect(activityTypeEnum.parse('NOTE')).toBe('NOTE')
    expect(activityTypeEnum.parse('EMAIL')).toBe('EMAIL')
    expect(activityTypeEnum.parse('FILE_ATTACHMENT')).toBe('FILE_ATTACHMENT')
  })

  it('rejects invalid types', () => {
    expect(() => activityTypeEnum.parse('UNKNOWN')).toThrow()
  })
})
