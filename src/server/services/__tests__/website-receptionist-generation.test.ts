import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ knowledge: vi.fn(), ai: vi.fn() }))
vi.mock('@/server/services/knowledge', () => ({ getReceptionistKnowledge: mocks.knowledge }))
vi.mock('@/server/services/ai', () => ({ generateWebsiteReceptionistText: mocks.ai }))
import { generateWebsiteReceptionistAnswer } from '../website-receptionist-generation'
beforeEach(() => { vi.resetAllMocks(); mocks.knowledge.mockResolvedValue({ text: 'Approved Sunday hours: 10 AM to 2 PM.', sources: [{ id: 'public', title: 'Approved hours', revision: 1, category: 'FAQ', excerpt: 'Approved Sunday hours: 10 AM to 2 PM.' }] }); mocks.ai.mockResolvedValue('We open Sundays from 10 AM to 2 PM.') })
describe('public website answer generation', () => {
  it('uses receptionist-approved library context and only caller history', async () => {
    expect(await generateWebsiteReceptionistAnswer('org', 'Synthetic business', 'Sunday hours?', ['What services do you offer?'])).toBe('We open Sundays from 10 AM to 2 PM.')
    expect(mocks.knowledge.mock.calls[0][0]).toBe('org')
    expect(mocks.ai).toHaveBeenCalledWith('org', 'Synthetic business', 'Sunday hours?', ['What services do you offer?'], 'Approved Sunday hours: 10 AM to 2 PM.')
  })
  it('does not request AI when there is no approved context', async () => {
    mocks.knowledge.mockResolvedValue({ text: '', sources: [] })
    expect(await generateWebsiteReceptionistAnswer('org', 'Business', 'Unlisted price?', [])).toMatch(/callback/i)
    expect(mocks.ai).not.toHaveBeenCalled()
  })
  it('bounds caller context and rejects invalid public reply text', async () => {
    await generateWebsiteReceptionistAnswer('org', 'Business', 'Question?', Array(4).fill('é'.repeat(1000)))
    expect(mocks.ai.mock.calls[0][3]).toHaveLength(2)
    expect(Buffer.byteLength(mocks.ai.mock.calls[0][3].join(''), 'utf8')).toBeLessThanOrEqual(1000)
    mocks.ai.mockResolvedValue('x'.repeat(601))
    await expect(generateWebsiteReceptionistAnswer('org', 'Business', 'Question?', [])).rejects.toBeDefined()
  })
})
