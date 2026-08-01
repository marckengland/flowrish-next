import type { MetadataRoute } from 'next'

import { siteConfig } from '@/lib/site'

/**
 * sitemap.xml — only the public, indexable landing page. Every other route
 * is authenticated (noindex + disallowed), so listing it would be wrong.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${siteConfig.url}/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ]
}
