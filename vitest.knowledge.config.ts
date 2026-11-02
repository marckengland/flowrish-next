import { defineConfig } from 'vitest/config'
import base from './vitest.config'
export default defineConfig({ ...base, test: { ...base.test, environment: 'node', setupFiles: [], include: ['scripts/knowledge.integration.test.ts'], testTimeout: 20000, hookTimeout: 60000, fileParallelism: false } })
