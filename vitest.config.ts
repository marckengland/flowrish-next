import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      'src/**/*.spec.{ts,tsx}',
      'src/**/*.property.test.{ts,tsx}',
    ],
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `server-only` exists only in Next's build graph; stub it so server
      // modules that import it can be unit-tested under Vitest.
      'server-only': path.resolve(__dirname, './src/test-stubs/server-only.ts'),
    },
  },
})
