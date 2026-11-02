import { defineConfig } from 'vitest/config'
import base from './vitest.config'

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    environment: 'node',
    setupFiles: [],
    include: ['scripts/follow-ups.integration.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
