/**
 * Single source of truth for public site / SEO config.
 *
 * Everything is driven off `NEXT_PUBLIC_SITE_URL` so metadata, canonicals,
 * the sitemap, robots, and JSON-LD resolve correctly across preview and
 * production domains. Set it in the deployment env; the fallback is only
 * for local dev.
 */
export const siteConfig = {
  name: 'Flowrish',
  /** Short marketing title. */
  title: 'Flowrish — The CRM that does the busywork',
  description:
    'Flowrish is a multi-tenant sales CRM that automates logging, follow-ups, lead scoring and forecasting, then hands every rep the single highest-value action to take next.',
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://flowrish.com').replace(/\/$/, ''),
  keywords: [
    'CRM',
    'sales CRM',
    'RevOps',
    'sales pipeline',
    'kanban pipeline',
    'lead scoring',
    'sales cadences',
    'sales automation',
    'revenue forecasting',
    'AI sales assistant',
    'click to call CRM',
    'Gmail CRM',
    'Outlook CRM',
  ],
  /** Used for Organization / entity-graph structured data. */
  sameAs: [] as string[],
} as const

export type SiteConfig = typeof siteConfig
