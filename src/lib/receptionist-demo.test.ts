import { describe, expect, it } from 'vitest'
import { createDemoState, demoHours, reduceDemo, type DemoAction, type DemoBusiness } from './receptionist-demo'

const business: DemoBusiness = { name: 'Flowrish', hours: 'Mon, Tue, Wed, Thu, Fri, 9:00 AM to 5:00 PM (Asia/Manila)', services: 'Flowrish manages sales leads and contacts.', pricing: 'Our team will confirm pricing.' }
function run(...actions: DemoAction[]) { return actions.reduce((state, action) => reduceDemo(state, action, business), createDemoState(business)) }
const reviewed: DemoAction[] = [{ type: 'message', text: 'Please call me back' }, { type: 'review_callback' }, { type: 'callback_consent', value: true }]
const handedOff: DemoAction[] = [...reviewed, { type: 'confirm_callback' }, { type: 'preview_handoff' }, { type: 'handoff_consent', value: true }, { type: 'confirm_handoff' }]

describe('in-memory receptionist demo', () => {
  it('formats saved callback hours without making an appointment promise', () => {
    expect(demoHours({ timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5] })).toBe(business.hours)
  })
  it.each([['What services do you offer?', business.services], ['What does it cost?', business.pricing], ['What are your hours?', business.hours], ['Can you guarantee tomorrow?', 'cannot answer that']])('uses prewritten replies for %s', (text, answer) => {
    const state = run({ type: 'message', text })
    expect(state.messages.at(-1)?.text).toContain(answer)
    expect(state.callbackStep).toBe('idle')
  })
  it('treats a callback-hours question as information rather than callback consent', () => {
    const state = run({ type: 'message', text: 'What are your callback hours?' })
    expect(state.messages.at(-1)?.text).toContain(business.hours)
    expect(state.callbackStep).toBe('idle')
  })
  it('never invents missing services, hours or prices', () => {
    const empty: DemoBusiness = { name: 'Another organization', hours: null, services: null, pricing: null }
    for (const text of ['Services?', 'Opening hours?', 'Pricing?']) {
      const state = reduceDemo(createDemoState(empty), { type: 'message', text }, empty)
      expect(state.messages.at(-1)?.text).toContain('team will confirm')
      expect(state.messages.at(-1)?.text).not.toContain('Flowrish')
    }
  })
  it('requires readback and fresh consent after a callback correction', () => {
    let state = run(...reviewed, { type: 'edit_callback', field: 'phone', value: '+12025550124' }, { type: 'confirm_callback' })
    expect(state.callbackStep).toBe('editing'); expect(state.callbackConsent).toBe(false)
    state = reduceDemo(state, { type: 'review_callback' }, business)
    expect(state.messages.at(-1)?.text).toContain('+12025550124')
    expect(reduceDemo(state, { type: 'confirm_callback' }, business).callbackStep).toBe('review')
    state = reduceDemo(state, { type: 'callback_consent', value: true }, business)
    state = reduceDemo(state, { type: 'confirm_callback' }, business)
    expect(state.callbackStep).toBe('confirmed')
    expect(reduceDemo(state, { type: 'confirm_callback' }, business)).toEqual(state)
  })
  it('validates callback fields and bounds messages and form values', () => {
    let state = run({ type: 'message', text: 'Callback please' }, { type: 'edit_callback', field: 'phone', value: 'invalid' }, { type: 'review_callback' })
    expect(state.callbackStep).toBe('editing'); expect(state.error).toContain('international phone')
    state = reduceDemo(state, { type: 'edit_callback', field: 'reason', value: 'x'.repeat(10000) }, business)
    expect(state.draft.reason.length).toBeLessThanOrEqual(1000)
    const initial = createDemoState(business)
    expect(reduceDemo(initial, { type: 'message', text: 'x'.repeat(1001) }, business).messages).toEqual(initial.messages)
    state = initial
    for (let i = 0; i < 50; i++) state = reduceDemo(state, { type: 'message', text: 'Hours?' }, business)
    expect(state.messages.length).toBeLessThanOrEqual(40)
  })
  it('requires a separate preview and approval for the simulated CRM handoff', () => {
    const confirmed = run(...reviewed, { type: 'confirm_callback' }, { type: 'confirm_handoff' })
    expect(confirmed.handoffStep).toBe('idle')
    const preview = reduceDemo(confirmed, { type: 'preview_handoff' }, business)
    expect(reduceDemo(preview, { type: 'confirm_handoff' }, business).handoffStep).toBe('review')
    const complete = run(...handedOff)
    expect(complete.handoffStep).toBe('created'); expect(complete.closed).toBe(false)
    expect(reduceDemo(complete, { type: 'confirm_handoff' }, business)).toEqual(complete)
  })
  it.each(['reached', 'no_answer', 'retry'] as const)('records %s only after outcome review and approval', outcome => {
    let state = run(...handedOff, { type: 'select_outcome', value: outcome }, { type: 'preview_outcome' }, { type: 'confirm_outcome' })
    expect(state.outcomes).toEqual([])
    state = reduceDemo(state, { type: 'outcome_consent', value: true }, business)
    state = reduceDemo(state, { type: 'confirm_outcome' }, business)
    expect(state.outcomes).toEqual([outcome]); expect(state.closed).toBe(outcome === 'reached')
    expect(reduceDemo(state, { type: 'confirm_outcome' }, business)).toEqual(state)
  })
  it('invalidates outcome approval on selection change and clears everything on restart', () => {
    const state = run(...handedOff, { type: 'preview_outcome' }, { type: 'outcome_consent', value: true }, { type: 'select_outcome', value: 'retry' }, { type: 'confirm_outcome' })
    expect(state.outcomes).toEqual([]); expect(state.outcomeConsent).toBe(false)
    expect(reduceDemo(state, { type: 'reset' }, business)).toEqual(createDemoState(business))
  })
})
