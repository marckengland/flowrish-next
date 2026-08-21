'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Props for {@link ExportButton}.
 *
 * `label` defaults to "Export CSV" and is overrideable so the same
 * component can double as a compact icon-only trigger on dashboards or
 * as a full-width primary action on the CSV page itself.
 */
export interface ExportButtonProps {
  /** Button label. Defaults to "Export CSV". */
  label?: string
  /** Optional className passthrough for layout tweaks. */
  className?: string
}

/**
 * CSV export trigger.
 *
 * Triggers a download from `GET /api/csv/export`. Instead of navigating
 * directly to the endpoint (which would require adjusting the middleware
 * Content-Disposition handling for top-level requests), the button
 * issues a `fetch` so the browser receives the response blob, then
 * programmatically creates an `<a download>` link and clicks it. The
 * filename is taken from the server's `Content-Disposition` header when
 * present and falls back to `leads-YYYY-MM-DD.csv` — matching the server
 * format — so downloads always land with a sensible name.
 *
 * The request is credentialed (`same-origin`) so session cookies flow
 * through; the server enforces `leads:read` and the usual org/RBAC
 * scoping. Soft-deleted leads are excluded by the access filter there.
 *
 * Errors surface inline underneath the button — no toast dependency —
 * so the component stays self-contained and stable to render anywhere.
 *
 * Validates: Requirement 11.6
 */
export function ExportButton({
  label = 'Export leads',
  className,
}: ExportButtonProps): React.JSX.Element {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick(): Promise<void> {
    setError(null)
    setIsLoading(true)
    try {
      const response = await fetch('/api/csv/export', {
        method: 'GET',
        credentials: 'same-origin',
      })

      if (!response.ok) {
        // Try to surface the server's error payload when possible.
        let message = `Export failed (status ${response.status})`
        try {
          const body = (await response.json()) as {
            error?: { message?: string }
          }
          if (body?.error?.message) message = body.error.message
        } catch {
          // Non-JSON body — fall back to the generic status message.
        }
        throw new Error(message)
      }

      const blob = await response.blob()
      const filename = filenameFromResponse(response)
      triggerDownload(blob, filename)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        onClick={handleClick}
        disabled={isLoading}
        aria-label={label}
      >
        {isLoading ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span>Exporting…</span>
          </>
        ) : (
          <>
            <Download className="size-4" aria-hidden="true" />
            <span>{label}</span>
          </>
        )}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger-foreground">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Extracts the filename from a `Content-Disposition: attachment; filename=..`
 * response header. Accepts both quoted and unquoted forms. Falls back to
 * a date-stamped default so downloads always have a sensible name.
 *
 * Exported for test coverage.
 */
export function filenameFromResponse(response: Response): string {
  const fallback = `leads-${new Date().toISOString().slice(0, 10)}.csv`
  const header = response.headers.get('Content-Disposition')
  if (!header) return fallback

  // Matches: filename="foo.csv", filename='foo.csv', or filename=foo.csv
  const match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(header)
  const name = match?.[1]?.trim()
  if (!name) return fallback
  return name
}

/**
 * Internal: synthesises a download link for the given blob + filename and
 * clicks it so the browser prompts the user. Cleans up the object URL
 * afterwards so long-lived pages don't leak memory.
 *
 * Guarded against server-side execution so unit tests and SSR do not
 * crash when accidentally rendered on the server.
 */
function triggerDownload(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Release the object URL on the next tick so the browser has time to
  // kick off the actual download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
