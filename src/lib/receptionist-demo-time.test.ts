import { describe, expect, it, vi } from 'vitest'
import { createDemoState, reduceDemo, type DemoAction, type DemoBusiness } from './receptionist-demo'
import { resolveCallbackTime } from './callback-time'
const callbackHours = { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], version: '2026-01-01T00:00:00.000Z' }
const day = new Date(Date.now() + 7 * 86400000); while (day.getUTCDay() !== 1) day.setUTCDate(day.getUTCDate() + 1)
const date = day.toISOString().slice(0, 10), requested = `${date}T10:00`, chosen = `${date}T11:00`
const business: DemoBusiness = { name: 'Sample Business', hours: 'Weekdays 9 to 5', services: null, pricing: null, callbackHours }
const run = (...actions: DemoAction[]) => actions.reduce((state, action) => reduceDemo(state, action, business), createDemoState(business))
const confirmed: DemoAction[] = [{ type: 'message', text: 'Callback please' }, { type: 'edit_callback', field: 'preferredLocalTime', value: requested }, { type: 'review_callback' }, { type: 'callback_consent', value: true }, { type: 'confirm_callback' }]

describe('preferred times in the in-memory demo', () => {
  it('validates a requested time and clears consent after a correction', () => {
    const state = run(...confirmed.slice(0, -1))
    expect(state.requestedTime?.at).toBe(resolveCallbackTime({ localTime: requested, timeZone: callbackHours.timeZone, businessVersion: callbackHours.version }, callbackHours).at)
    expect(state.messages.at(-1)?.text).toContain(`${date} 10:00 (Asia/Manila)`)
    const changed = reduceDemo(state, { type: 'edit_callback', field: 'preferredLocalTime', value: chosen }, business)
    expect(changed.callbackStep).toBe('editing'); expect(changed.callbackConsent).toBe(false)
    const invalid = run({ type: 'message', text: 'Callback please' }, { type: 'edit_callback', field: 'preferredLocalTime', value: `${date}T17:00` }, { type: 'review_callback' })
    expect(invalid.error).toContain('business hours'); expect(invalid.callbackStep).toBe('editing')
  })
  it('requires staff preview and fresh handoff approval for the chosen time', () => {
    let state = run(...confirmed, { type: 'edit_staff_time', value: chosen }, { type: 'preview_handoff' }, { type: 'handoff_consent', value: true })
    expect(state.confirmedTime).toBe(null)
    state = reduceDemo(state, { type: 'edit_staff_time', value: `${date}T12:00` }, business)
    expect(state.handoffConsent).toBe(false); expect(state.handoffStep).toBe('idle')
    state = reduceDemo(state, { type: 'preview_handoff' }, business); state = reduceDemo(state, { type: 'handoff_consent', value: true }, business); state = reduceDemo(state, { type: 'confirm_handoff' }, business)
    expect(state.confirmedTime?.localTime).toBe(`${date}T12:00`); expect(state.requestedTime?.localTime).toBe(requested)
  })
  it('rechecks future time at callback, handoff and retry confirmation', () => {
    const callback = run(...confirmed.slice(0, -1))
    const handoff = run(...confirmed, { type: 'preview_handoff' }, { type: 'handoff_consent', value: true })
    const retry = run(...confirmed, { type: 'preview_handoff' }, { type: 'handoff_consent', value: true }, { type: 'confirm_handoff' }, { type: 'select_outcome', value: 'retry' }, { type: 'edit_staff_time', value: chosen }, { type: 'preview_outcome' }, { type: 'outcome_consent', value: true })
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(Date.parse(resolveCallbackTime({ localTime: chosen, timeZone: callbackHours.timeZone, businessVersion: callbackHours.version }, callbackHours).at) + 60000))
      const callbackResult = reduceDemo(callback, { type: 'confirm_callback' }, business), handoffResult = reduceDemo(handoff, { type: 'confirm_handoff' }, business), retryResult = reduceDemo(retry, { type: 'confirm_outcome' }, business)
      expect(callbackResult.callbackStep).toBe('editing'); expect(callbackResult.callbackConsent).toBe(false)
      expect(handoffResult.handoffStep).toBe('idle'); expect(handoffResult.handoffConsent).toBe(false)
      expect(retryResult.outcomes).toEqual([]); expect(retryResult.outcomeConsent).toBe(false)
      for (const state of [callbackResult, handoffResult, retryResult]) expect(state.error).toContain('future')
    } finally { vi.useRealTimers() }
  })
  it('keeps the original requested time when a simulated retry reschedules the task', () => {
    let state = run(...confirmed, { type: 'preview_handoff' }, { type: 'handoff_consent', value: true }, { type: 'confirm_handoff' }, { type: 'select_outcome', value: 'retry' }, { type: 'edit_staff_time', value: chosen }, { type: 'preview_outcome' }, { type: 'outcome_consent', value: true }, { type: 'confirm_outcome' })
    expect(state.confirmedTime?.localTime).toBe(chosen); expect(state.requestedTime?.localTime).toBe(requested); expect(state.closed).toBe(false)
    state = reduceDemo(state, { type: 'reset' }, business)
    expect(state.requestedTime).toBe(null); expect(state.confirmedTime).toBe(null); expect(state.draft.preferredLocalTime).toBe('')
  })
})
