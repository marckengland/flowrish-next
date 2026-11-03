import { describe, expect, it } from 'vitest'
import { websiteCallbackInputSchema, websiteCallbackRecordSchema, websiteSessionResultSchema } from './website-receptionist'
import { handoffOptionsSchema, handoffReceiptSchema } from './callback-handoff'

const calendar = { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], version: '2026-01-01T00:00:00.000Z' }
const selection = { localTime: '2030-01-07T09:30', timeZone: calendar.timeZone, businessVersion: calendar.version }
const preferredTime = { ...selection, at: '2030-01-07T01:30:00.000Z' }
const id = '11111111-1111-4111-8111-111111111111'
const callback = { id, fullName: 'Sample Visitor', phone: '+12025550123', reason: 'Services', siteOrigin: 'https://example.test', status: 'pending', consentedAt: calendar.version, createdAt: calendar.version, updatedAt: calendar.version }

describe('optional callback-time wire contracts', () => {
  it('accepts a requested time without changing legacy callback inputs', () => {
    const legacy = { fullName: callback.fullName, phone: callback.phone, reason: callback.reason, confirmed: true, website: '' }
    expect(websiteCallbackInputSchema.parse(legacy)).toEqual(legacy)
    expect(websiteCallbackInputSchema.parse({ ...legacy, preferredTime: selection }).preferredTime).toEqual(selection)
    expect(websiteCallbackInputSchema.safeParse({ ...legacy, preferredTime: { ...selection, at: preferredTime.at } }).success).toBe(false)
  })
  it('exposes only a validated public calendar in optional session metadata', () => {
    const legacy = { token: 'a'.repeat(64), businessName: 'Sample', greeting: 'Hello', expiresAt: calendar.version, turn: 0 }
    expect(websiteSessionResultSchema.parse(legacy)).toEqual(legacy)
    expect(websiteSessionResultSchema.parse({ ...legacy, callbackHours: calendar }).callbackHours).toEqual(calendar)
    expect(websiteSessionResultSchema.safeParse({ ...legacy, callbackHours: { ...calendar, knowledge: 'private' } }).success).toBe(false)
  })
  it('retains canonical timing in callback lists and durable handoff receipts', () => {
    expect(websiteCallbackRecordSchema.parse({ ...callback, preferredTime }).preferredTime).toEqual(preferredTime)
    const receipt = { callbackId: id, leadId: id, taskId: id, createdAt: calendar.version, leadAvailable: true, taskAvailable: true, preferredTime }
    expect(handoffReceiptSchema.parse(receipt).preferredTime).toEqual(preferredTime)
    const options = { callback: { ...callback, preferredTime }, receipt: null, leads: [], contacts: [], members: [], stages: [], matchesTruncated: false, choicesTruncated: false, callbackHours: calendar }
    expect(handoffOptionsSchema.parse(options).callbackHours).toEqual(calendar)
  })
})
