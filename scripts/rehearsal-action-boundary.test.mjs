import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
test('fixture form actions resolve only to local fake adapters while production modules remain forbidden', async () => {
  const { default: config } =
    await import('../e2e/rehearsal-app/next.config.mjs')
  const webpack = config.webpack({ resolve: { alias: {} }, plugins: [] })
  let resolve
  webpack.plugins[0].apply({
    hooks: {
      normalModuleFactory: {
        tap: (_name, apply) =>
          apply({
            hooks: {
              beforeResolve: {
                tap: (_hook, check) => {
                  resolve = check
                },
              },
            },
          }),
      },
    },
  })
  for (const name of ['leads', 'tasks']) {
    const request = {
      request: `@/server/actions/${name}`,
      context: process.cwd(),
    }
    resolve(request)
    assert.equal(
      request.request,
      path.join(process.cwd(), 'e2e/rehearsal-app/mocks', `${name}-actions.ts`),
    )
  }
  for (const request of [
    '@/server/db/client',
    '@/server/actions/email',
    '@/server/actions/leads/other',
    './src/server/actions/leads',
    '@prisma/client',
    '@supabase/ssr',
  ])
    assert.throws(
      () => resolve({ request, context: process.cwd() }),
      /forbidden/,
    )
})
