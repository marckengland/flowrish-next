import { requireSession } from '@/server/auth/session'
import { hasPermission } from '@/server/auth/permissions'
import { getFieldMappings } from '@/server/services/csv-import'
import { ImportWizard } from '@/components/csv/import-wizard'
import { ExportButton } from '@/components/csv/export-button'

/**
 * CSV Import/Export page — Server Component.
 *
 * Provides a unified interface for:
 * - Importing leads from CSV files (multi-step wizard)
 * - Exporting current leads to CSV
 *
 * Access:
 * - Import requires `leads:write` permission
 * - Export requires `leads:read` permission
 *
 * The page pre-fetches saved field mappings so the import wizard can
 * offer them as quick-select options without an extra round-trip.
 *
 * Validates: Requirements 11.1, 11.6
 */
export default async function CSVPage(): Promise<React.JSX.Element> {
  const session = await requireSession()

  const canWrite = hasPermission(session.dbUser, 'leads:write')
  const canRead = hasPermission(session.dbUser, 'leads:read')

  // Pre-fetch saved field mappings for the import wizard
  const savedMappings = canWrite
    ? (await getFieldMappings(session.organizationId)).map((m) => ({
        id: m.id,
        name: m.name,
        mapping: m.mapping,
      }))
    : []

  if (!canWrite && !canRead) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border bg-card p-6">
        <h1 className="text-lg font-semibold">CSV Import &amp; Export</h1>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to import or export leads in this
          organization.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            CSV Import &amp; Export
          </h1>
          <p className="text-sm text-muted-foreground">
            Bulk import leads from CSV files or export your current pipeline
            data.
          </p>
        </div>
        {canRead && <ExportButton />}
      </header>

      {canWrite && (
        <section aria-labelledby="import-heading">
          <h2
            id="import-heading"
            className="mb-3 text-lg font-medium tracking-tight"
          >
            Import leads
          </h2>
          <ImportWizard savedMappings={savedMappings} />
        </section>
      )}

      {!canWrite && canRead && (
        <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
          You have read-only access. Contact an admin to get import permissions.
        </div>
      )}
    </div>
  )
}
