import { Inngest } from 'inngest'
import { env } from '@/lib/env'

/**
 * Inngest client singleton for flowrish-next.
 *
 * Used to define durable functions and send events.
 * The signing key authenticates requests from Inngest Cloud.
 * The event key authenticates outbound event sends.
 */
export const inngest = new Inngest({
  id: 'flowrish-next',
  eventKey: env.INNGEST_EVENT_KEY,
})
