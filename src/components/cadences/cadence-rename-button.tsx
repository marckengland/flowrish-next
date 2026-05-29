'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CadenceNameDialog } from '@/components/cadences/cadence-name-dialog'

export interface CadenceRenameButtonProps {
  cadenceId: string
  currentName: string
}

/**
 * Client-side trigger for the cadence rename dialog.
 *
 * Lives in its own file so a Server Component (the cadence detail
 * page) can drop it into the header without converting the whole page
 * into a client island. Hidden when the dialog isn't useful — e.g. an
 * archived cadence — should be the parent's responsibility; this
 * component renders the button unconditionally.
 */
export function CadenceRenameButton({
  cadenceId,
  currentName,
}: CadenceRenameButtonProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label="Rename cadence"
        title="Rename"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </Button>
      <CadenceNameDialog
        open={open}
        onClose={() => setOpen(false)}
        cadenceId={cadenceId}
        currentName={currentName}
      />
    </>
  )
}
