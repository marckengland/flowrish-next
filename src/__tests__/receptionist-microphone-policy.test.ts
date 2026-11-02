// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/supabase/middleware', () => ({ createSupabaseMiddleware: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'synthetic-admin' } } }) } }) }))
import { middleware } from '../middleware'
it.each(['/settings', '/dashboard', '/login'])('permits same-origin microphone requests across client navigation from %s', async path => {
 const response = await middleware(new NextRequest('https://flowrish.example' + path))
 expect(response.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(self), geolocation=(), payment=()')
 expect(response.headers.get('X-Frame-Options')).toBe('DENY')
})
