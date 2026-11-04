import type {
  WaitlistEntry,
  WaitlistOptions,
  WaitlistPreview,
  WaitlistReceipt,
} from '@/lib/staff-waitlist'
export const waitlistIds = {
  entry: '44444444-4444-4444-8444-444444444444',
  user: '33333333-3333-4333-8333-333333333333',
  stage: '55555555-5555-4555-8555-555555555555',
  lead: '66666666-6666-4666-8666-666666666666',
}
export function sampleWaitlistEntry(): WaitlistEntry {
  return {
    id: waitlistIds.entry,
    email: 'jamie@example.test',
    name: 'Jamie Example',
    status: 'pending',
    source: 'public_demo',
    reviewStatus: 'new',
    reviewVersion: 0,
    createdAt: '2026-11-04T01:00:00.000Z',
    updatedAt: '2026-11-04T01:00:00.000Z',
  }
}
export function sampleWaitlistOptions(): WaitlistOptions {
  return {
    entry: sampleWaitlistEntry(),
    receipt: null,
    leads: [],
    members: [{ id: waitlistIds.user, label: 'Sample staff' }],
    stages: [{ id: waitlistIds.stage, label: 'Sales / New' }],
    matchesTruncated: false,
    choicesTruncated: false,
  }
}
export function sampleWaitlistPreview(): WaitlistPreview {
  return {
    version: 'a'.repeat(64),
    organizationName: 'Flowrish',
    action: 'create',
    targetLabel: 'Jamie Example',
    email: 'jamie@example.test',
    ownerLabel: 'Sample staff',
    stageLabel: 'Sales / New',
  }
}
export function sampleWaitlistReceipt(): WaitlistReceipt {
  return {
    leadId: waitlistIds.lead,
    leadAvailable: true,
    createdLead: true,
    createdAt: '2026-11-04T01:00:00.000Z',
  }
}
