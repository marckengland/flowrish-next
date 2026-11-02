import { describe, expect, it, vi } from 'vitest'
import {
  receptionistConfigSchema, isBusinessOpen, nextBusinessOpening,
  advanceCall, initialCallState, gatherTwiml, type ReceptionistConfig,
  callStateSchema,
} from './receptionist'

const config: ReceptionistConfig = {
  enabled: false, businessName: 'Acme', knowledge: 'We repair bicycles.',
  mode: 'after_hours', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00',
  businessDays: [1, 2, 3, 4, 5], forwardTo: '+639171234567',
  assigneeId: '11111111-1111-4111-8111-111111111111',
  stageId: '22222222-2222-4222-8222-222222222222',
}

describe('receptionist configuration and scheduling', () => {
  it('rejects invalid time zones, overnight hours and enabled after-hours mode without a destination', () => {
    expect(receptionistConfigSchema.safeParse({ ...config, timeZone: 'Moon/Base' }).success).toBe(false)
    expect(receptionistConfigSchema.safeParse({ ...config, opensAt: '18:00' }).success).toBe(false)
    expect(receptionistConfigSchema.safeParse({ ...config, enabled: true, forwardTo: '' }).success).toBe(false)
    expect(receptionistConfigSchema.safeParse({ ...config, enabled: true, mode: 'always', forwardTo: '' }).success).toBe(true)
  })

  it('uses the business time zone and exclusive closing boundary', () => {
    expect(isBusinessOpen(config, new Date('2026-11-02T01:00:00Z'))).toBe(true)
    expect(isBusinessOpen(config, new Date('2026-11-02T09:00:00Z'))).toBe(false)
    expect(isBusinessOpen(config, new Date('2026-11-01T01:00:00Z'))).toBe(false)
  })

  it('schedules the next opening after a weekend and a daylight-saving change', () => {
    expect(nextBusinessOpening(config, new Date('2026-11-06T10:00:00Z')).toISOString()).toBe('2026-11-09T01:00:00.000Z')
    expect(nextBusinessOpening({ ...config, timeZone: 'America/New_York' }, new Date('2026-10-30T23:00:00Z')).toISOString()).toBe('2026-11-02T14:00:00.000Z')
  })

  it('uses the first valid business minute when daylight saving skips the opening time', () => {
    const sunday = { ...config, timeZone: 'America/New_York', businessDays: [0], opensAt: '02:30' }
    const opening = nextBusinessOpening(sunday, new Date('2027-03-14T05:00:00Z'))
    expect(opening.toISOString()).toBe('2027-03-14T07:00:00.000Z')
    expect(isBusinessOpen(sunday, opening)).toBe(true)
  })
})

describe('receptionist conversation', () => {
  const extracted = { fullName: 'Jane Smith', phone: '+639181234567', reason: 'Bicycle repair', reply: 'I can take a message.' }

  it('reads back all details and requires explicit confirmation before capture', async () => {
    const generate = vi.fn().mockResolvedValue(extracted)
    const result = await advanceCall(initialCallState('+639181234567'), { speech: 'Jane Smith, bicycle repair' }, config, generate)
    expect(result.capture).toBe(false)
    expect(result.state.awaitingConfirmation).toBe(true)
    expect(result.reply).toContain('Jane Smith')
    expect(result.reply).toContain('Bicycle repair')
    expect(result.reply).toContain('+ 6 3 9 1 8 1 2 3 4 5 6 7')
    const confirmed = await advanceCall(result.state, { digits: '1' }, config, generate)
    expect(confirmed.capture).toBe(true)
    expect(confirmed.finish).toBe(true)
  })

  it('does not treat a correction or an initial yes as confirmation', async () => {
    const generate = vi.fn().mockResolvedValue({ ...extracted, phone: '+639191234567' })
    const initial = await advanceCall(initialCallState('+639181234567'), { speech: 'yes' }, config, generate)
    expect(initial.capture).toBe(false)
    const corrected = await advanceCall(initial.state, { speech: 'Yes, but my number is different' }, config, generate)
    expect(corrected.capture).toBe(false)
    expect(corrected.state.phone).toBe('+639191234567')
  })

  it('ends repeated silence without creating a lead or callback', async () => {
    const generate = vi.fn()
    const first = await advanceCall(initialCallState('anonymous'), {}, config, generate)
    expect(first.finish).toBe(false)
    const second = await advanceCall(first.state, {}, config, generate)
    expect(second.finish).toBe(true)
    expect(second.capture).toBe(false)
    expect(generate).not.toHaveBeenCalled()
  })

  it('takes a structured callback message when the AI provider is unavailable', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('secret-provider-detail'))
    let result = await advanceCall(initialCallState('+639181234567'), { speech: 'Are you open?' }, config, generate)
    expect(result.reply).not.toContain('secret-provider-detail')
    expect(result.state.fallbackField).toBe('fullName')
    result = await advanceCall(result.state, { speech: 'Jane Smith' }, config, generate)
    result = await advanceCall(result.state, { speech: 'Please call about a repair' }, config, generate)
    expect(result.state.awaitingConfirmation).toBe(true)
    expect(result.capture).toBe(false)
    result = await advanceCall(result.state, { speech: 'yes' }, config, generate)
    expect(result.capture).toBe(true)
  })

  it('does not reconfirm stale details when the AI fails during a correction', async () => {
    const previous = { ...initialCallState('+639181234567'), fullName: 'Jane Smith', reason: 'Repair', awaitingConfirmation: true }
    const result = await advanceCall(previous, { speech: 'No, that number is wrong' }, config, vi.fn().mockRejectedValue(new Error('offline')))
    expect(result.state.awaitingConfirmation).toBe(false)
    expect(result.state.phone).toBe('')
    expect(result.capture).toBe(false)
  })

  it('accepts a complete callback number from the keypad in fallback mode', async () => {
    const previous = { ...initialCallState('anonymous'), fullName: 'Jane Smith', reason: 'Repair', fallbackField: 'phone' as const }
    const result = await advanceCall(previous, { digits: '639181234567' }, config, vi.fn())
    expect(result.state.phone).toBe('+639181234567')
    expect(result.state.awaitingConfirmation).toBe(true)
  })

  it('rejects malformed AI fields and stops excessive conversation turns', async () => {
    const generate = vi.fn().mockResolvedValue({ ...extracted, phone: 'not-a-number' })
    const result = await advanceCall(initialCallState('anonymous'), { speech: 'Hello' }, config, generate)
    expect(result.state.awaitingConfirmation).toBe(false)
    expect(result.capture).toBe(false)
    const capped = await advanceCall({ ...initialCallState('anonymous'), turns: 12 }, { speech: 'hello' }, config, generate)
    expect(capped.finish).toBe(true)
    expect(capped.capture).toBe(false)
  })

  it('escapes caller text and query strings in TwiML', () => {
    const xml = gatherTwiml('Hello <script>&"', '/call?turn=2&org=1', false)
    expect(xml).toContain('&lt;script&gt;&amp;&quot;')
    expect(xml).toContain('turn=2&amp;org=1')
    expect(xml).toContain('actionOnEmptyResult="true"')
    expect(xml).not.toContain('<script>')
  })

  it('can reload a readback containing the maximum allowed caller details', async () => {
    const result = await advanceCall(initialCallState('+639181234567'), { speech: 'Hello' }, config, vi.fn().mockResolvedValue({ fullName: 'J'.repeat(120), phone: '+639181234567', reason: 'R'.repeat(2000), reply: 'Thanks' }))
    expect(callStateSchema.safeParse(result.state).success).toBe(true)
  })
})
