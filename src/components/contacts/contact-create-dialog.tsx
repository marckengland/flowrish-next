'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ContactForm, type ContactFormCompany } from './contact-form'

export interface ContactCreateDialogProps {
  /** Companies available for linking. */
  companies?: readonly ContactFormCompany[]
}

/**
 * Button + inline form panel for creating a new contact.
 *
 * Uses a simple show/hide pattern rather than a modal dialog to keep
 * the implementation lightweight and accessible.
 *
 * Validates: Requirement 19.1
 */
export function ContactCreateDialog({
  companies = [],
}: ContactCreateDialogProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden="true" />
        <span>New contact</span>
      </Button>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold">Create Contact</h2>
      <ContactForm
        companies={companies}
        onSuccess={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </div>
  )
}
