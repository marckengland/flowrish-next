import { defineConfig } from 'vitest/config'
import path from 'node:path'
export default defineConfig({ test: { environment: 'node', include: ['scripts/calendar-exceptions.integration.test.ts'], testTimeout: 30000, hookTimeout: 60000, fileParallelism: false }, resolve: { alias: { '@': path.resolve(__dirname, './src'), 'server-only': path.resolve(__dirname, './src/test-stubs/server-only.ts') } } })
