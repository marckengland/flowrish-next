import type { MetadataRoute } from 'next'

import { siteConfig } from '@/lib/site'

/**
 * Web app manifest — name, description, brand colors, and the lily icon.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${siteConfig.name} — CRM`,
    short_name: siteConfig.name,
    description: siteConfig.description,
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1aa46e',
    icons: [
      { src: '/flower-emerald.png', sizes: '468x468', type: 'image/png' },
      { src: '/icon.png', sizes: '468x468', type: 'image/png', purpose: 'any' },
    ],
  }
}
