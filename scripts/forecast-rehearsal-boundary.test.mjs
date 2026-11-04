import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
test('forecast forms resolve to one exact fake adapter and keep neighboring server paths forbidden', async () => {
  const { default: config } = await import('../e2e/rehearsal-app/next.config.mjs')
  const webpack = config.webpack({ resolve: { alias: {} }, plugins: [] })
  let resolve
  webpack.plugins[0].apply({ hooks: { normalModuleFactory: { tap: (_name, apply) => apply({ hooks: { beforeResolve: { tap: (_hook, check) => { resolve = check } } } }) } } })
  const request = { request: '@/server/actions/forecast', context: process.cwd() }
  resolve(request)
  assert.equal(request.request, path.join(process.cwd(), 'e2e/rehearsal-app/mocks/forecast-actions.ts'))
  for (const name of ['@/server/actions/forecast/other', './src/server/actions/forecast', '@/server/services/forecast', '@/server/db/client', '@prisma/client']) assert.throws(() => resolve({ request: name, context: process.cwd() }), /forbidden/)
})
