import { z } from 'zod'
export const pilotNextStepSchema = z.enum([
  'business',
  'knowledge',
  'ai',
  'website',
  'rehearsal',
  'manual_review',
])
export const pilotProgressSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('not_joined'),
      invitation: z.enum(['not_issued', 'active', 'expired', 'revoked']),
      checkedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      state: z.literal('unavailable'),
      checkedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      state: z.literal('joined'),
      checkedAt: z.string().datetime(),
      businessSaved: z.boolean(),
      knowledge: z
        .object({
          services: z.boolean(),
          pricing: z.boolean(),
          faqs: z.boolean(),
        })
        .strict(),
      aiConfigured: z.boolean(),
      websiteSaved: z.boolean(),
      widgetEnabled: z.boolean(),
      rehearsal: z.enum([
        'not_saved',
        'incomplete',
        'unreviewed',
        'needs_work',
        'stale',
        'passed',
      ]),
      nextStep: pilotNextStepSchema,
    })
    .strict(),
])
export type PilotProgress = z.infer<typeof pilotProgressSchema>
export const pilotNextSteps: Record<
  z.infer<typeof pilotNextStepSchema>,
  string
> = {
  business: 'Save and review business details.',
  knowledge:
    'Publish and approve services, pricing guidance, and FAQs in the Library.',
  ai: 'Configure and enable organization AI with spending limits.',
  website:
    'Save the allowed website and widget limits without enabling the widget.',
  rehearsal:
    'Complete, save, and review a browser rehearsal for the saved setup.',
  manual_review:
    'Review the pilot manually with the business before any launch.',
}
