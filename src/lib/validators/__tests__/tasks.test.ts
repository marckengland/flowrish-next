import { describe, it, expect } from 'vitest'
import { taskCreateSchema, taskUpdateSchema, taskPriorityEnum } from '../tasks'

describe('taskCreateSchema', () => {
  const validTask = {
    title: 'Follow up with lead',
    dueDate: '2025-03-15T10:00:00Z',
    leadId: '550e8400-e29b-41d4-a716-446655440000',
    assigneeId: '660e8400-e29b-41d4-a716-446655440000',
  }

  it('accepts valid task with defaults', () => {
    const result = taskCreateSchema.parse(validTask)
    expect(result.title).toBe('Follow up with lead')
    expect(result.dueDate).toBeInstanceOf(Date)
    expect(result.priority).toBe('MEDIUM')
    expect(result.leadId).toBe(validTask.leadId)
    expect(result.assigneeId).toBe(validTask.assigneeId)
  })

  it('accepts task with explicit priority', () => {
    const result = taskCreateSchema.parse({ ...validTask, priority: 'HIGH' })
    expect(result.priority).toBe('HIGH')
  })

  it('accepts task with description', () => {
    const result = taskCreateSchema.parse({
      ...validTask,
      description: 'Send proposal document',
    })
    expect(result.description).toBe('Send proposal document')
  })

  it('rejects missing title', () => {
    const { title, ...noTitle } = validTask
    expect(() => taskCreateSchema.parse(noTitle)).toThrow()
  })

  it('rejects empty title', () => {
    expect(() => taskCreateSchema.parse({ ...validTask, title: '' })).toThrow()
  })

  it('rejects title exceeding 500 characters', () => {
    expect(() => taskCreateSchema.parse({ ...validTask, title: 'a'.repeat(501) })).toThrow()
  })

  it('rejects missing dueDate', () => {
    const { dueDate, ...noDueDate } = validTask
    expect(() => taskCreateSchema.parse(noDueDate)).toThrow()
  })

  it('rejects missing leadId', () => {
    const { leadId, ...noLeadId } = validTask
    expect(() => taskCreateSchema.parse(noLeadId)).toThrow()
  })

  it('rejects invalid leadId format', () => {
    expect(() => taskCreateSchema.parse({ ...validTask, leadId: 'bad' })).toThrow()
  })

  it('rejects missing assigneeId', () => {
    const { assigneeId, ...noAssigneeId } = validTask
    expect(() => taskCreateSchema.parse(noAssigneeId)).toThrow()
  })

  it('rejects invalid assigneeId format', () => {
    expect(() => taskCreateSchema.parse({ ...validTask, assigneeId: 'bad' })).toThrow()
  })

  it('rejects invalid priority', () => {
    expect(() => taskCreateSchema.parse({ ...validTask, priority: 'URGENT' })).toThrow()
  })

  it('strips null bytes from title', () => {
    const result = taskCreateSchema.parse({ ...validTask, title: 'Follow\0up' })
    expect(result.title).toBe('Followup')
  })

  it('rejects path traversal in title', () => {
    expect(() => taskCreateSchema.parse({ ...validTask, title: '../admin' })).toThrow()
  })
})

describe('taskUpdateSchema', () => {
  it('accepts empty object (no fields to update)', () => {
    const result = taskUpdateSchema.parse({})
    expect(result).toBeDefined()
  })

  it('accepts partial updates', () => {
    const result = taskUpdateSchema.parse({ title: 'Updated title', priority: 'HIGH' })
    expect(result.title).toBe('Updated title')
    expect(result.priority).toBe('HIGH')
  })

  it('accepts isComplete flag', () => {
    const result = taskUpdateSchema.parse({ isComplete: true })
    expect(result.isComplete).toBe(true)
  })

  it('rejects invalid priority on update', () => {
    expect(() => taskUpdateSchema.parse({ priority: 'CRITICAL' })).toThrow()
  })

  it('rejects invalid assigneeId on update', () => {
    expect(() => taskUpdateSchema.parse({ assigneeId: 'not-uuid' })).toThrow()
  })
})

describe('taskPriorityEnum', () => {
  it('accepts all valid priorities', () => {
    expect(taskPriorityEnum.parse('LOW')).toBe('LOW')
    expect(taskPriorityEnum.parse('MEDIUM')).toBe('MEDIUM')
    expect(taskPriorityEnum.parse('HIGH')).toBe('HIGH')
  })

  it('rejects invalid priorities', () => {
    expect(() => taskPriorityEnum.parse('URGENT')).toThrow()
    expect(() => taskPriorityEnum.parse('CRITICAL')).toThrow()
  })
})
