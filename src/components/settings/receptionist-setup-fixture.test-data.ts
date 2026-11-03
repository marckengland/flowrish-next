import type { SetupSnapshot } from '@/lib/receptionist-setup'
export function setupFixture(): SetupSnapshot {
  return {
    version: 'a'.repeat(64), checkedAt: '2026-11-03T00:00:00.000Z',
    business: { saved: true, updatedAt: '2026-11-03T00:00:00.000Z', phoneEnabled: false, values: { businessName: 'Sample Repairs', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5] } },
    website: { settings: { publicId: '11111111-1111-4111-8111-111111111111', enabled: false, allowedOrigins: ['https://shop.example'], dailyMessageLimit: 5, dailyTokenLimit: 20000, dailyCallbackLimit: 10, updatedAt: '2026-11-03T00:00:00.000Z' }, hasSavedBusiness: true, hasOrganizationAi: true, approvedDocuments: 1, usage: { sessions: 0, messages: 0, reservedTokens: 0, callbacks: 0 } },
    knowledge: { total: 1, published: 1, approved: 1, approvedCategories: ['PRICING'], sample: { category: 'PRICING', text: 'Repairs cost 500 pesos after inspection approval.' } }, readyToEnable: true,
  }
}
