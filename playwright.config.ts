import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for end-to-end smoke tests.
 *
 * Runs in two phases:
 *   1. `setup` project — signs in once and persists the auth state to
 *      `e2e/.auth/user.json` (a Supabase admin-minted magic link is
 *      followed in `e2e/auth.setup.ts`).
 *   2. `chromium` project — replays the saved storage state and runs
 *      the actual smoke tests against the authed dashboard.
 *
 * Required env vars (read from `.env`):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SECRET_KEY (service role key)
 *   - E2E_TEST_USER_EMAIL (an existing user in the org you want to test)
 *
 * Run with:
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  // Smoke tests are sequential by design — they walk shared routes and
  // we want one consistent authed identity. Parallelism inside Playwright
  // would still spawn separate browser contexts but reuse storage state.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
