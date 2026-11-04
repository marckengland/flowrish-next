import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const actionMocks = {
  '@/lib/supabase/client': path.join(root, 'e2e/rehearsal-app/mocks/supabase-client.ts'),
  '@/server/actions/forecast': path.join(root, 'e2e/rehearsal-app/mocks/forecast-actions.ts'),
  '@/server/actions/leads': path.join(
    root,
    'e2e/rehearsal-app/mocks/leads-actions.ts',
  ),
  '@/server/actions/tasks': path.join(
    root,
    'e2e/rehearsal-app/mocks/tasks-actions.ts',
  ),
}
const config = {
  experimental: { externalDir: true },
  webpack(config) {
    config.resolve.alias['@'] = path.join(root, 'src')
    config.plugins.push({
      apply(compiler) {
        compiler.hooks.normalModuleFactory.tap(
          'RehearsalServerBoundary',
          (factory) => {
            factory.hooks.beforeResolve.tap(
              'RehearsalServerBoundary',
              (data) => {
                if (!data) return
                if (Object.hasOwn(actionMocks, data.request)) {
                  data.request = actionMocks[data.request]
                  return
                }
                const resolved = data.request.startsWith('.')
                  ? path.resolve(data.context, data.request)
                  : data.request
                if (
                  resolved.startsWith('@/server/') ||
                  resolved.includes('/src/server/') ||
                  resolved.startsWith('@/lib/supabase/') ||
                  resolved.includes('/src/lib/supabase/') ||
                  /^(?:@prisma\/|@supabase\/|pg$|postgres$)/.test(resolved)
                ) {
                  throw new Error(
                    'Production server, database and auth modules are forbidden in the rehearsal app.',
                  )
                }
              },
            )
          },
        )
      },
    })
    return config
  },
}

export default config
