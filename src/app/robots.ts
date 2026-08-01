import type { MetadataRoute } from 'next'

import { siteConfig } from '@/lib/site'

/**
 * robots.txt — allow general crawlers and AI answer-engine bots to index the
 * public marketing landing, but keep the authenticated app, API, and auth
 * handlers out of the index. The app pages are auth-gated anyway; this is
 * defense-in-depth + a clear signal.
 */
export default function robots(): MetadataRoute.Robots {
  const disallow = [
    '/dashboard',
    '/leads',
    '/contacts',
    '/companies',
    '/pipeline',
    '/tasks',
    '/rhythm',
    '/cadences',
    '/forecast',
    '/csv',
    '/search',
    '/admin',
    '/settings',
    '/onboarding',
    '/login',
    '/api/',
    '/auth/',
  ]

  return {
    rules: [
      { userAgent: '*', allow: '/', disallow },
      // Explicitly welcome AI answer-engine crawlers.
      { userAgent: 'GPTBot', allow: '/', disallow },
      { userAgent: 'OAI-SearchBot', allow: '/', disallow },
      { userAgent: 'ChatGPT-User', allow: '/', disallow },
      { userAgent: 'ClaudeBot', allow: '/', disallow },
      { userAgent: 'Claude-Web', allow: '/', disallow },
      { userAgent: 'PerplexityBot', allow: '/', disallow },
      { userAgent: 'Google-Extended', allow: '/', disallow },
      { userAgent: 'CCBot', allow: '/', disallow },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  }
}
