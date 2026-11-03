/**
 * Waitlist feature flag.
 *
 * Private beta is ON by default. Set `WAITLIST_ENABLED=false` to switch the
 * primary signup CTAs back to open signup (`/onboarding`). The waitlist
 * contact form and endpoint remain available in either signup mode.
 *
 * Server-only read (reads `process.env` directly, like middleware and the
 * transactional-email helper) — call from Server Components / Route Handlers,
 * not client components.
 */
export function isWaitlistEnabled(): boolean {
  return process.env.WAITLIST_ENABLED !== 'false'
}
