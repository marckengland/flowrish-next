import type { ResponsePolicyMetadata } from '@/lib/callback-response'
export const responseManager = '11111111-1111-4111-8111-111111111111'
export function responseFixture(): ResponsePolicyMetadata {
  return { policy: { enabled: false, handoffMinutes: 60, attemptMinutes: 120, backupUserId: null, hours: null, updatedAt: null, businessUpdatedAt: null, lastCheckedAt: null }, business: { businessName: 'Sample Repairs', hours: { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5] }, updatedAt: '2026-11-03T00:00:00.000Z' }, managers: [{ id: responseManager, name: 'Sample Manager' }], managersTruncated: false, managerAvailable: false, hoursChanged: false }
}
