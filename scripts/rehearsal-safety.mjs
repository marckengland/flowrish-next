import { once } from 'node:events'

export function allowedTarget(host, port, ports) {
  return (
    ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) &&
    Number.isInteger(Number(port)) &&
    ports.includes(Number(port))
  )
}

export function cleanEnvironment(parent) {
  const result = { NEXT_TELEMETRY_DISABLED: '1' }
  for (const name of [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SystemRoot',
    'CI',
    'TERM',
    'NO_COLOR',
  ]) {
    if (parent[name] !== undefined) result[name] = parent[name]
  }
  return result
}

export async function stopChildren(children, graceMs = 3000) {
  await Promise.all(
    [...children].map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = once(child, 'exit').catch(() => {})
      child.kill('SIGTERM')
      let timer
      await Promise.race([
        exited,
        new Promise((resolve) => {
          timer = setTimeout(resolve, graceMs)
        }),
      ])
      clearTimeout(timer)
      if (child.exitCode !== null || child.signalCode !== null) return
      child.kill('SIGKILL')
      try {
        await Promise.race([
          exited,
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    'Owned rehearsal child did not exit after SIGKILL.',
                  ),
                ),
              1000,
            )
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
    }),
  )
}
