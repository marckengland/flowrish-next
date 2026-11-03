import type { ReceptionistHomeSnapshot } from '@/lib/receptionist-home'
export function homeFixture(canManage = true, canWork = true): ReceptionistHomeSnapshot {
  return { asOf: '2026-11-03T12:00:00.000Z', businessName: canManage ? 'Sample Repairs' : 'Sample Organization', canManage, canWork, readiness: canManage ? { businessSaved: true, provider: 'configured', approvedDocuments: 2, websiteSaved: true, websiteValid: true, websiteEnabled: false, allowedWebsites: 1, prerequisitesSaved: true } : null, counts: { pendingHandoffs: canManage ? 3 : null, openCallbacks: canWork ? 5 : null, overdueCallbacks: canWork ? 2 : null, missedHandoffs: canManage ? 1 : null, missedContacts: canWork ? 1 : null }, targets: { enabled: true, checkedAt: '2026-11-03T11:59:00.000Z' } }
}
