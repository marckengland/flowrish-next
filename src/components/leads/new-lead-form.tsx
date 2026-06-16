'use client'

import { useRouter } from 'next/navigation'

import { LeadForm, type LeadFormStage } from '@/components/leads/lead-form'

export interface NewLeadFormProps {
  stages: readonly LeadFormStage[]
}

/**
 * Thin client wrapper around `LeadForm` for the `/leads/new` route.
 *
 * - Renders the form in create mode (no `lead` prop).
 * - Redirects to the new lead's detail page on success so the user
 *   lands on the same surface the table row click navigates to.
 * - Cancel returns the user to the leads list.
 */
export function NewLeadForm({ stages }: NewLeadFormProps): React.JSX.Element {
  const router = useRouter()

  return (
    <LeadForm
      stages={stages}
      onSuccess={(leadId) => router.push(`/leads/${leadId}`)}
      onCancel={() => router.push('/leads')}
      submitLabel="Create lead"
    />
  )
}
