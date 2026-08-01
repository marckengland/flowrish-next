/**
 * Waitlist feature flag.
 *
 * Private beta is ON by default. Set `WAITLIST_ENABLED=false` to switch the
 * marketing CTAs back to open signup (`/onboarding`), hide the waitlist form,
 * and disable the `POST /api/waitlist` endpoint.
 *
 * Server-only read (reads `process.env` directly, like middleware and the
 * transactional-email helper) — call from Server Components / Route Handlers,
 * not client components.
 */
export function isWaitlistEnabled(): boolean {
  return process.env.WAITLIST_ENABLED !== 'false'
}
