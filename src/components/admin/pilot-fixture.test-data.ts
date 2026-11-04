import { sampleWaitlistEntry } from './waitlist-fixture.test-data'
export const syntheticPilotToken = 'b'.repeat(64)
export const syntheticPilotLink = `https://flowrish.marckengland.com/pilot#invite=${syntheticPilotToken}`
export const pilotFixture = () => ({
  entry: sampleWaitlistEntry(),
  invitation: null,
})
export const issuedPilotFixture = () => ({
  entry: { ...sampleWaitlistEntry(), status: 'invited', reviewVersion: 1 },
  invitation: {
    generation: 1,
    email: 'jamie@example.test',
    state: 'active' as const,
    issuedAt: '2026-11-04T01:00:00.000Z',
    expiresAt: '2026-11-11T01:00:00.000Z',
    acceptedAt: null,
  },
})
