'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CompanyForm } from './company-form'

/**
 * Button + inline form panel for creating a new company.
 *
 * Uses a simple show/hide pattern rather than a modal dialog to keep
 * the implementation lightweight and accessible.
 *
 * Validates: Requirement 19.3
 */
export function CompanyCreateDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden="true" />
        <span>New company</span>
      </Button>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold">Create Company</h2>
      <CompanyForm
        onSuccess={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </div>
  )
}
