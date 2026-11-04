import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
test('keyboard fixture replaces only the exact browser auth import and rejects real auth clients', async () => {
  const { default: config } = await import('../e2e/rehearsal-app/next.config.mjs')
  const webpack = config.webpack({ resolve: { alias: {} }, plugins: [] })
  let resolve
  webpack.plugins[0].apply({ hooks: { normalModuleFactory: { tap: (_name, apply) => apply({ hooks: { beforeResolve: { tap: (_hook, check) => { resolve = check } } } }) } } })
  const request = { request: '@/lib/supabase/client', context: process.cwd() }
  resolve(request)
  assert.equal(request.request, path.join(process.cwd(), 'e2e/rehearsal-app/mocks/supabase-client.ts'))
  for (const name of ['@supabase/ssr', '@supabase/supabase-js', '@/lib/supabase/server', './src/lib/supabase/client']) assert.throws(() => resolve({ request: name, context: process.cwd() }), /forbidden/)
})
