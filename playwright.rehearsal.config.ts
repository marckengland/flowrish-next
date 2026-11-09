import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.REHEARSAL_BASE_URL
const proxy = process.env.REHEARSAL_PROXY_URL
if (!baseURL || !proxy)
  throw new Error(
    'Run npm run test:receptionist:mocked; do not target a deployed app.',
  )
for (const value of [baseURL, proxy]) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
    throw new Error('Rehearsal URLs must be explicit loopback HTTP origins.')
}

export default defineConfig({
  testDir: './e2e',
  testMatch: [
    'saved-follow-up-views.spec.ts',
    'saved-lead-views.spec.ts',
    'bulk-lead-updates.spec.ts',
    'safe-lead-merges.spec.ts',
    'merge-aware-replies.spec.ts',
    'email-notifications.spec.ts',
    'follow-up-access.spec.ts',
    'follow-up-snooze.spec.ts',
    'follow-up-history.spec.ts',
    'follow-up-search.spec.ts',
    'follow-up-load-more.spec.ts',
    'callback-catch-up-progress.spec.ts',
    'bulk-follow-up-snooze.spec.ts',
    'bulk-follow-up-approval.spec.ts',
    'approved-task-progress.spec.ts',
    'approved-task-completion.spec.ts',
    'approved-task-reschedule.spec.ts',
    'approved-task-history.spec.ts',
    'approved-deadline-sort.spec.ts',
    'bulk-task-completion.spec.ts',
    'bulk-task-reschedule.spec.ts',
    'saved-task-batches.spec.ts',
    'remaining-tasks.spec.ts',
    'bulk-actions-menu.spec.ts',
    'compact-follow-up-cards.spec.ts',
    'compact-card-error-recovery.spec.ts',
    'compact-inbox-controls.spec.ts',
    'inbox-tab-counts.spec.ts',
    'inbox-freshness.spec.ts',
    'overdue-inbox-shortcut.spec.ts',
    'large-follow-up-inbox.spec.ts',
    'contact-preferences.spec.ts',
    'keyboard-accessibility.spec.ts',
    'receptionist-demo.spec.ts',
    'public-receptionist-demo.spec.ts',
    'staff-waitlist.spec.ts',
    'pilot-onboarding.spec.ts',
    'pilot-progress.spec.ts',
    'core-workflow.spec.ts',
    'workspace-switcher.spec.ts',
    'pipeline-forecast.spec.ts',
    'forecast-history.spec.ts',
    'website-callback-time.spec.ts',
    'callback-handoff.spec.ts',
    'callback-outcomes.spec.ts',
    'follow-ups.spec.ts',
    'receptionist-preview.spec.ts',
  ],
  grep: /inbox freshness|large follow-up inbox|overdue inbox shortcut|inbox tab counts|compact inbox controls|compact card error recovery|compact follow-up cards|bulk actions menu|remaining task review|saved task batches|bulk task reschedule|bulk task completion|approved deadline sort|approved task history|approved task reschedule|approved task completion|approved task progress|bulk follow-up approval|saved follow-up views|bulk follow-up snooze|callback catch-up progress|follow-up load more|follow-up search|follow-up history|follow-up snooze|contact preferences|follow-up access|email notifications|merge-aware replies|safe lead merges|bulk lead updates|saved lead views|keyboard audit|forecast history|pipeline audit|workspace switcher|core audit|pilot progress|pilot onboarding|staff waitlist|explores the public receptionist sample|practices receptionist conversation|approves .*callback handoff|records, retries|preferred business-local|uncertain timed request|fresh review after|stale business hours|new widget script|reviews a synthetic reply|onboards the entered business|keeps text preview/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/rehearsal/browser',
  reporter: [
    ['line'],
    ['json', { outputFile: 'test-results/rehearsal/results.json' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    storageState: { cookies: [], origins: [] },
    proxy: { server: proxy, bypass: '<-loopback>' },
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
})
