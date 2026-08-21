'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'

export interface CadenceNameDialogProps {
  open: boolean
  onClose: () => void
  cadenceId: string
  /** Current cadence name pre-filled into the input. */
  currentName: string
  /** Optional callback after a successful rename. */
  onRenamed?: (newName: string) => void
}

/**
 * Inline rename dialog for a cadence. PATCHes the cadence record via
 * `/api/cadences/[id]` with just the `name` field — the same endpoint
 * used by other cadence updates, so existing audit + revalidate paths
 * apply automatically.
 *
 * Validates: Requirements 6.1
 */
export function CadenceNameDialog({
  open,
  onClose,
  cadenceId,
  currentName,
  onRenamed,
}: CadenceNameDialogProps): React.JSX.Element {
  const router = useRouter()
  const [name, setName] = useState(currentName)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save(): void {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Cadence name is required.')
      return
    }
    if (trimmed === currentName.trim()) {
      onClose()
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/cadences/${cadenceId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ name: trimmed }),
        })
        if (!res.ok) {
          let message = `Rename failed (${res.status})`
          try {
            const body = (await res.json()) as { error?: { message?: string } }
            if (body.error?.message) message = body.error.message
          } catch {
            // ignore
          }
          setError(message)
          return
        }
        onRenamed?.(trimmed)
        onClose()
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Rename failed.')
      }
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Rename cadence"
      size="sm"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>Saving…</span>
              </>
            ) : (
              <span>Save</span>
            )}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="cadence-name-input" className="text-xs font-medium">
          Name
        </label>
        <input
          id="cadence-name-input"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            }
          }}
          disabled={pending}
          className="h-9 w-full rounded-lg border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        {error ? (
          <p role="alert" className="text-xs text-danger-foreground">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
