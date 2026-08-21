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
 *   npm run test:e2e          # local dev server (auto-started)
 *   npm run test:e2e:prod     # against a deployed URL (read-only smoke)
 *
 * ── Prod profile ────────────────────────────────────────────────────────────
 * A "prod" run is any run pointed at a deployed URL, detected by the presence
 * of `PLAYWRIGHT_BASE_URL`. Because Playwright's `workers`/`fullyParallel`/
 * `retries` are GLOBAL (not per-project), the profile is env-driven here rather
 * than expressed as an extra project. Against prod we serialize and slow down
 * so we don't burst past the app's Upstash rate limiter (sliding window), and
 * we skip any `@write` specs unless `E2E_ALLOW_WRITES` is set — so a prod run
 * never mutates the live database by accident.
 */
const isProd = Boolean(process.env.PLAYWRIGHT_BASE_URL)

export default defineConfig({
  testDir: './e2e',
  // Serialize against prod (one worker, no intra-file parallelism) to respect
  // the rate limiter. Locally we still parallelize for speed.
  fullyParallel: !isProd,
  forbidOnly: !!process.env.CI,
  retries: isProd ? 2 : process.env.CI ? 1 : 0,
  workers: isProd || process.env.CI ? 1 : undefined,
  // Real network + cold serverless need more headroom than localhost.
  timeout: isProd ? 60_000 : 30_000,
  expect: { timeout: isProd ? 15_000 : 5_000 },
  // Guard: don't run write/destructive specs against a deployed environment
  // unless explicitly opted in. Read-only smoke tests always run.
  grepInvert: isProd && !process.env.E2E_ALLOW_WRITES ? /@write/ : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Optional rate-limit bypass for CI/repeated prod runs. Only sent when
    // E2E_BYPASS_TOKEN is set; the app must validate it server-side (not
    // wired by default — see the PR discussion on prod-security tradeoffs).
    extraHTTPHeaders: process.env.E2E_BYPASS_TOKEN
      ? { 'x-e2e-bypass': process.env.E2E_BYPASS_TOKEN }
      : {},
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
