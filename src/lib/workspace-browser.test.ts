import { beforeEach, expect, it, vi } from 'vitest'
import { clearWorkspaceBrowserState, workspaceFetch } from './workspace-browser'
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
it('pins same-origin API and Next action calls without losing bodies, cancellation or caller headers', async () => {
  const original = vi
    .fn()
    .mockResolvedValue(
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
    )
  const fetch = workspaceFetch(
    original,
    'https://flowrish.example.test',
    'business-one',
    vi.fn(),
    () => false,
  )
  const controller = new AbortController()
  await fetch('/api/tasks', {
    method: 'POST',
    body: 'synthetic',
    signal: controller.signal,
    headers: { 'content-type': 'application/json' },
  })
  const options = original.mock.calls[0][1]
  expect(options.method).toBe('POST')
  expect(options.body).toBe('synthetic')
  expect(options.signal).toBe(controller.signal)
  expect(options.headers.get('x-flowrish-workspace')).toBe('business-one')
  expect(options.headers.get('content-type')).toBe('application/json')
  await fetch('https://flowrish.example.test/tasks', {
    method: 'POST',
    headers: { 'next-action': 'synthetic-action' },
    body: 'form',
  })
  expect(original.mock.calls[1][1].headers.get('next-action')).toBe(
    'synthetic-action',
  )
  expect(original.mock.calls[1][1].headers.get('x-flowrish-workspace')).toBe(
    'business-one',
  )
})
it('leaves external provider requests and unrelated static requests untouched', async () => {
  const original = vi.fn().mockResolvedValue(new Response('{}'))
  const fetch = workspaceFetch(
    original,
    'https://flowrish.example.test',
    'business-one',
    vi.fn(),
    () => false,
  )
  const options = { method: 'POST', body: 'synthetic' }
  await fetch('https://provider.example.test/never-live', options)
  expect(original).toHaveBeenLastCalledWith(
    'https://provider.example.test/never-live',
    options,
  )
  await fetch('/flower-emerald.png')
  expect(original).toHaveBeenLastCalledWith('/flower-emerald.png', undefined)
})
it('blocks new workspace work during switching but permits the explicit selector request', async () => {
  const original = vi.fn().mockResolvedValue(new Response('{}'))
  const fetch = workspaceFetch(
    original,
    'https://flowrish.example.test',
    'business-one',
    vi.fn(),
    () => true,
  )
  await expect(fetch('/api/tasks', { method: 'PATCH' })).rejects.toThrow(
    /business/i,
  )
  await expect(
    fetch('/tasks', {
      method: 'POST',
      headers: { 'next-action': 'synthetic' },
    }),
  ).rejects.toThrow(/business/i)
  expect(original).not.toHaveBeenCalled()
  await fetch('/api/workspaces', { method: 'POST' })
  expect(original).toHaveBeenCalledTimes(1)
})
it('invalidates once a server reports changed or revoked workspace context', async () => {
  const stale = vi.fn()
  const original = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { code: 'WORKSPACE_CHANGED' } }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
    )
  const fetch = workspaceFetch(
    original,
    'https://flowrish.example.test',
    'business-one',
    stale,
    () => false,
  )
  expect((await fetch('/api/tasks')).status).toBe(409)
  expect(stale).toHaveBeenCalledTimes(1)
})
it('clears business filter and conversation pointers while preserving theme and unrelated storage', () => {
  localStorage.setItem(
    'flowrish:leads:filters',
    '{"assigneeId":"old-business-user"}',
  )
  sessionStorage.setItem('airish:active-conversation', 'old-business-thread')
  localStorage.setItem('flowrish:theme', 'dark')
  localStorage.setItem('unrelated', 'keep')
  clearWorkspaceBrowserState()
  expect(localStorage.getItem('flowrish:leads:filters')).toBeNull()
  expect(sessionStorage.getItem('airish:active-conversation')).toBeNull()
  expect(localStorage.getItem('flowrish:theme')).toBe('dark')
  expect(localStorage.getItem('unrelated')).toBe('keep')
})
