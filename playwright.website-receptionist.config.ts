import { defineConfig, devices } from '@playwright/test'

// Entirely routed synthetic HTTPS origins; no app, auth, environment file, or provider.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['website-receptionist.spec.ts', 'website-receptionist-feedback.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' },
})
