'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Upload, X } from 'lucide-react'

import { Button } from '@/components/ui/button'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024 // 25 MB — matches /api/upload service

export interface FileUploadProps {
  /** The lead the uploaded file should be attached to. */
  leadId: string
  /** Optional callback fired after a successful upload. */
  onUploaded?: (result: {
    attachmentId: string
    storagePath: string
    activityId: string
    fileName: string
  }) => void
  /** Optional callback when the user cancels the picker. */
  onCancel?: () => void
}

/**
 * Lead file uploader. Picks a single file, validates it client-side
 * (size only — the server re-validates MIME and size), and POSTs the
 * file as multipart/form-data to `/api/upload`. The upload service
 * creates an Activity row with a NOTE type plus a FileAttachment.
 *
 * Used both standalone (lead detail surface) and as part of the
 * activity composer flow when a user wants to drop a file alongside
 * a note.
 */
export function FileUpload({
  leadId,
  onUploaded,
  onCancel,
}: FileUploadProps): React.JSX.Element {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSelect(event: React.ChangeEvent<HTMLInputElement>): void {
    setError(null)
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError('File exceeds the 25 MB maximum.')
      setSelected(null)
      return
    }
    setSelected(file)
  }

  function clearSelection(): void {
    setSelected(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function upload(): void {
    if (!selected) return
    setError(null)
    startTransition(async () => {
      const formData = new FormData()
      formData.append('file', selected)
      formData.append('leadId', leadId)
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          credentials: 'same-origin',
          body: formData,
        })
        if (!res.ok) {
          let message = `Upload failed (${res.status})`
          try {
            const body = (await res.json()) as { error?: { message?: string } }
            if (body.error?.message) message = body.error.message
          } catch {
            // ignore parse failure
          }
          setError(message)
          return
        }
        const body = (await res.json()) as {
          data: {
            attachmentId: string
            storagePath: string
            activityId: string
          }
        }
        onUploaded?.({ ...body.data, fileName: selected.name })
        clearSelection()
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed.')
      }
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleSelect}
        className="hidden"
        aria-label="Choose file to upload"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={pending}
        >
          <Upload className="size-3.5" aria-hidden="true" />
          <span>Choose file</span>
        </Button>
        {selected ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="max-w-[200px] truncate" title={selected.name}>
              {selected.name}
            </span>
            <span>({formatSize(selected.size)})</span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-muted-foreground hover:text-destructive"
              aria-label={`Remove ${selected.name}`}
              disabled={pending}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Up to 25 MB. PDFs, images, docs, spreadsheets.
          </span>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          onClick={upload}
          disabled={!selected || pending}
        >
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              <span>Uploading…</span>
            </>
          ) : (
            <span>Upload</span>
          )}
        </Button>
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
