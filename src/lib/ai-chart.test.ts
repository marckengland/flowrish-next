import { describe, expect, it } from 'vitest'
import { aiChartSchema } from './ai-chart'

const sample = { type: 'bar', title: 'Supplied pipeline', data: [{ label: 'Qualified', value: 2 }] }
const details = { columns: ['Name', 'Next step'], rows: [['Maya Demo', 'Review outline'], ['Luis Example', 'Retry call']] }
const withDetails = (value: unknown) => ({ ...sample, data: [{ ...sample.data[0], details: value }] })

describe('AI chart detail contract', () => {
  it('retains existing aggregate-only charts', () => {
    expect(aiChartSchema.parse(sample)).toEqual(sample)
  })

  it('accepts bounded supplied rows, preserving text and numeric cells', () => {
    const value = { columns: ['Name', 'Value'], rows: [['Maya Demo', 0], ['Luis Example', -2.5]] }
    expect(aiChartSchema.parse(withDetails(value)).data[0].details).toEqual(value)
  })

  it('preserves untrusted cell text as inert data', () => {
    const value = { columns: ['Note'], rows: [['<script>alert(1)</script>'], ['javascript:alert(1)']] }
    expect(aiChartSchema.parse(withDetails(value)).data[0].details).toEqual(value)
  })

  it.each([
    { columns: [], rows: [['Maya']] },
    { columns: [''], rows: [['Maya']] },
    { columns: ['Name', 'Name'], rows: [['Maya', 'Demo']] },
    { columns: ['x'.repeat(41)], rows: [['Maya']] },
    { columns: Array.from({ length: 7 }, (_, i) => String(i)), rows: [Array(7).fill('value')] },
    { ...details, rows: [] },
    { ...details, rows: [['Maya']] },
    { ...details, rows: [['Maya', 'Review', 'Extra']] },
    { ...details, rows: Array(21).fill(['Maya', 'Review']) },
    { columns: ['Name'], rows: [['x'.repeat(161)]] },
    { columns: ['Value'], rows: [[Infinity]] },
    { columns: ['Value'], rows: [[NaN]] },
    { columns: ['Value'], rows: [[1e99]] },
    { columns: ['Value'], rows: [[null]] },
    { columns: ['Value'], rows: [[true]] },
    { columns: ['Value'], rows: [[{ label: 'nested' }]] },
    { ...details, href: '/leads' },
    { ...details, action: { type: 'create_lead' } },
  ])('rejects malformed or executable detail shapes: %j', value => {
    expect(aiChartSchema.safeParse(withDetails(value)).success).toBe(false)
  })

  it('accepts the limits without changing existing point and chart limits', () => {
    const value = { columns: Array.from({ length: 6 }, (_, i) => String(i)), rows: Array(20).fill(Array(6).fill('x'.repeat(160))) }
    expect(aiChartSchema.safeParse(withDetails(value)).success).toBe(true)
    expect(aiChartSchema.safeParse({ ...sample, data: Array(13).fill(sample.data[0]) }).success).toBe(false)
    expect(aiChartSchema.safeParse({ ...sample, href: 'https://example.invalid' }).success).toBe(false)
    expect(aiChartSchema.safeParse({ ...sample, data: [{ ...sample.data[0], href: '/leads' }] }).success).toBe(false)
  })
})
