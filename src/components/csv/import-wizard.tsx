'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  FileUp,
  Loader2,
  Check,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * System fields available for CSV column mapping.
 * Mirrors `IMPORTABLE_FIELDS` from the server-side CSV import service.
 */
const SYSTEM_FIELDS: ReadonlyArray<{
  value: string
  label: string
  required: boolean
}> = [
  { value: 'firstName', label: 'First Name', required: true },
  { value: 'lastName', label: 'Last Name', required: true },
  { value: 'email', label: 'Email', required: false },
  { value: 'altEmail', label: 'Alt Email', required: false },
  { value: 'phone', label: 'Phone', required: false },
  { value: 'title', label: 'Title', required: false },
  { value: 'description', label: 'Description', required: false },
  { value: 'dealValue', label: 'Deal Value', required: false },
  { value: 'currency', label: 'Currency', required: false },
  { value: 'leadStatus', label: 'Lead Status', required: false },
  { value: 'tier', label: 'Tier', required: false },
  { value: 'linkedinUrl', label: 'LinkedIn URL', required: false },
  { value: 'country', label: 'Country', required: false },
  { value: 'state', label: 'State', required: false },
  { value: 'companyName', label: 'Company Name', required: false },
  { value: 'companyIndustry', label: 'Company Industry', required: false },
  { value: 'companyWebsite', label: 'Company Website', required: false },
  { value: 'stageId', label: 'Stage ID', required: false },
]

type WizardStep = 'upload' | 'mapping' | 'preview' | 'result'

const WIZARD_STEPS = ['upload', 'mapping', 'preview', 'result'] as const

interface PreviewRow {
  rowNumber: number
  mapped: Record<string, string>
  valid: boolean
  error?: string
}

interface ImportResult {
  successCount: number
  skipCount: number
  totalRows: number
  errors: Array<{ row: number; message: string }>
}

interface SavedFieldMapping {
  id: string
  name: string
  mapping: Record<string, string>
}

export interface ImportWizardProps {
  /** Saved field mappings for the current organization. */
  savedMappings?: SavedFieldMapping[]
  /** Optional className passthrough. */
  className?: string
}

/**
 * CSV Import Wizard — multi-step interface for importing leads from CSV.
 *
 * Steps:
 * 1. Upload: User selects a CSV file
 * 2. Mapping: User maps CSV columns to system fields (or picks a saved mapping)
 * 3. Preview: Validation preview showing which rows will succeed/fail
 * 4. Result: Import summary with success/skip counts
 *
 * The wizard communicates with:
 * - POST /api/csv/import — to execute the actual import
 *
 * Validates: Requirements 11.1, 11.6
 */
export function ImportWizard({
  savedMappings = [],
  className,
}: ImportWizardProps): React.JSX.Element {
  const [step, setStep] = useState<WizardStep>('upload')
  const [csvContent, setCsvContent] = useState<string>('')
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvRowCount, setCsvRowCount] = useState(0)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [previewValid, setPreviewValid] = useState(0)
  const [previewInvalid, setPreviewInvalid] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  // ─── Step 1: File Upload ─────────────────────────────────────────────────

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      setError(null)
      const file = event.target.files?.[0]
      if (!file) return

      if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
        setError('Please select a CSV file')
        return
      }

      if (file.size > MAX_CSV_FILE_SIZE) {
        setError(
          `File is too large (${formatBytes(file.size)}). Split it into files under ${formatBytes(MAX_CSV_FILE_SIZE)} and upload separately.`,
        )
        return
      }

      setIsLoading(true)
      try {
        const text = await file.text()
        if (!text.trim()) {
          setError('The file is empty')
          return
        }

        // Parse the CSV as a full document so quoted fields containing
        // newlines are handled correctly. Splitting on `\r?\n` first (as
        // an earlier version did) breaks any RFC 4180 CSV with multi-line
        // values — a common shape in real exports.
        let records: string[][]
        try {
          records = parseCsv(text)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to parse the file')
          return
        }
        if (records.length < 2) {
          setError('CSV must have a header row and at least one data row')
          return
        }

        const headers = records[0]!
        setCsvContent(text)
        setCsvHeaders(headers)
        setCsvRowCount(records.length - 1) // Exclude header
        setFileName(file.name)

        // Auto-map columns that match system field names (case-insensitive,
        // punctuation-tolerant, alias-aware).
        const autoMapping: Record<string, string> = {}
        const seen = new Set<string>()
        for (const header of headers) {
          const key = normalizeHeader(header)
          const match =
            FIELD_ALIASES[key]
            ?? SYSTEM_FIELDS.find((f) => f.value.toLowerCase() === key)?.value
          if (match && !seen.has(match)) {
            autoMapping[header] = match
            seen.add(match)
          }
        }
        setMapping(autoMapping)
        setStep('mapping')
      } catch {
        setError('Failed to read the file')
      } finally {
        setIsLoading(false)
      }
    },
    [],
  )

  // ─── Step 2: Column Mapping ──────────────────────────────────────────────

  const handleMappingChange = useCallback(
    (csvHeader: string, systemField: string) => {
      setMapping((prev) => {
        const next = { ...prev }
        if (systemField === '') {
          delete next[csvHeader]
        } else {
          next[csvHeader] = systemField
        }
        return next
      })
    },
    [],
  )

  const handleLoadSavedMapping = useCallback(
    (savedMapping: SavedFieldMapping) => {
      // Only apply mappings for headers that exist in the current CSV
      const applicable: Record<string, string> = {}
      for (const [csvHeader, systemField] of Object.entries(
        savedMapping.mapping,
      )) {
        if (csvHeaders.includes(csvHeader)) {
          applicable[csvHeader] = systemField
        }
      }
      setMapping(applicable)
    },
    [csvHeaders],
  )

  const requiredFieldsMapped = useMemo(() => {
    const mappedValues = Object.values(mapping)
    return (
      mappedValues.includes('firstName') && mappedValues.includes('lastName')
    )
  }, [mapping])

  // ─── Step 3: Preview ─────────────────────────────────────────────────────

  const handlePreview = useCallback(async () => {
    setError(null)
    setIsLoading(true)
    try {
      let records: string[][]
      try {
        records = parseCsv(csvContent)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse the file')
        return
      }
      const headers = records[0] ?? []
      const dataRecords = records.slice(1)
      const previewRecords = dataRecords.slice(0, PREVIEW_ROW_LIMIT)

      const rows: PreviewRow[] = previewRecords.map((values, index) => {
        const mapped: Record<string, string> = {}
        for (const [csvHeader, systemField] of Object.entries(mapping)) {
          const headerIndex = headers.indexOf(csvHeader)
          if (headerIndex >= 0 && values[headerIndex] !== undefined) {
            mapped[systemField] = values[headerIndex]
          }
        }

        const errors: string[] = []
        if (!mapped.firstName?.trim()) errors.push('First name is required')
        if (!mapped.lastName?.trim()) errors.push('Last name is required')

        return {
          rowNumber: index + 2,
          mapped,
          valid: errors.length === 0,
          error: errors[0],
        }
      })

      setPreviewRows(rows)
      setPreviewValid(rows.filter((r) => r.valid).length)
      setPreviewInvalid(rows.filter((r) => !r.valid).length)
      setStep('preview')
    } catch {
      setError('Failed to generate preview')
    } finally {
      setIsLoading(false)
    }
  }, [csvContent, mapping])

  // ─── Step 4: Execute Import ──────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    setError(null)
    setIsLoading(true)
    try {
      const response = await fetch('/api/csv/import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent, mapping }),
      })

      if (!response.ok) {
        let message = `Import failed (status ${response.status})`
        try {
          const body = (await response.json()) as {
            error?: { message?: string }
          }
          if (body?.error?.message) message = body.error.message
        } catch {
          // Non-JSON body
        }
        throw new Error(message)
      }

      const body = (await response.json()) as { data: ImportResult }
      setResult(body.data)
      setStep('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setIsLoading(false)
    }
  }, [csvContent, mapping])

  // ─── Reset ───────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    setStep('upload')
    setCsvContent('')
    setCsvHeaders([])
    setCsvRowCount(0)
    setMapping({})
    setPreviewRows([])
    setPreviewValid(0)
    setPreviewInvalid(0)
    setResult(null)
    setError(null)
    setFileName(null)
  }, [])

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className={className}>
      {/* Step indicator */}
      <nav aria-label="Import progress" className="mb-6">
        <ol className="flex items-center gap-3">
          {WIZARD_STEPS.map((s, i) => {
            const currentIndex = WIZARD_STEPS.indexOf(step)
            const status =
              i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'pending'
            return (
              <li key={s} className="contents">
                {i > 0 && (
                  <span
                    className="h-px flex-1 bg-border"
                    aria-hidden="true"
                  />
                )}
                <div
                  className="flex items-center gap-2"
                  aria-current={status === 'active' ? 'step' : undefined}
                >
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tnum',
                      status === 'done' && 'bg-brand text-brand-foreground',
                      status === 'active' && 'bg-foreground text-background',
                      status === 'pending' && 'bg-muted text-muted-foreground',
                    )}
                  >
                    {status === 'done' ? (
                      <Check className="size-3.5" aria-hidden="true" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span
                    className={cn(
                      'text-[13px] whitespace-nowrap',
                      status === 'pending'
                        ? 'text-muted-foreground'
                        : 'font-medium text-foreground',
                    )}
                  >
                    {stepLabel(s)}
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Error display */}
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-danger/30 bg-danger-subtle p-3 text-sm text-danger-foreground"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Step content */}
      {step === 'upload' && (
        <UploadStep
          isLoading={isLoading}
          onFileChange={handleFileChange}
        />
      )}

      {step === 'mapping' && (
        <MappingStep
          csvHeaders={csvHeaders}
          csvRowCount={csvRowCount}
          fileName={fileName}
          mapping={mapping}
          savedMappings={savedMappings}
          requiredFieldsMapped={requiredFieldsMapped}
          isLoading={isLoading}
          onMappingChange={handleMappingChange}
          onLoadSavedMapping={handleLoadSavedMapping}
          onBack={handleReset}
          onNext={handlePreview}
        />
      )}

      {step === 'preview' && (
        <PreviewStep
          previewRows={previewRows}
          validCount={previewValid}
          invalidCount={previewInvalid}
          totalRows={csvRowCount}
          isLoading={isLoading}
          onBack={() => setStep('mapping')}
          onImport={handleImport}
        />
      )}

      {step === 'result' && result && (
        <ResultStep result={result} onReset={handleReset} />
      )}
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function UploadStep({
  isLoading,
  onFileChange,
}: {
  isLoading: boolean
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="flex flex-col items-center gap-3.5 rounded-lg border-2 border-dashed bg-card px-6 py-14">
      <FileUp className="size-10 text-muted-foreground" aria-hidden="true" strokeWidth={1.6} />
      <div className="text-center">
        <p className="text-[15px] font-semibold text-foreground">Upload a CSV file</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Include a header row with column names · up to 10 MB
        </p>
      </div>
      <label className="cursor-pointer">
        <Button type="button" disabled={isLoading} aria-label="Choose CSV file">
          {isLoading ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>Reading…</span>
            </>
          ) : (
            <span>Choose file</span>
          )}
        </Button>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={onFileChange}
          className="sr-only"
          aria-label="CSV file input"
        />
      </label>
    </div>
  )
}

function MappingStep({
  csvHeaders,
  csvRowCount,
  fileName,
  mapping,
  savedMappings,
  requiredFieldsMapped,
  isLoading,
  onMappingChange,
  onLoadSavedMapping,
  onBack,
  onNext,
}: {
  csvHeaders: string[]
  csvRowCount: number
  fileName: string | null
  mapping: Record<string, string>
  savedMappings: SavedFieldMapping[]
  requiredFieldsMapped: boolean
  isLoading: boolean
  onMappingChange: (csvHeader: string, systemField: string) => void
  onLoadSavedMapping: (saved: SavedFieldMapping) => void
  onBack: () => void
  onNext: () => void
}) {
  // Track which system fields are already mapped to prevent duplicates
  const usedSystemFields = new Set(Object.values(mapping))

  return (
    <div className="flex flex-col gap-4">
      {/* File info */}
      <div className="flex items-center gap-2 rounded-[9px] border bg-brand-subtle/30 px-3.5 py-2.5 text-[13px] text-muted-foreground">
        <Check
          className="size-3.5 shrink-0 text-brand-emphasis"
          aria-hidden="true"
        />
        <span>
          {fileName} —{' '}
          <strong className="font-semibold text-foreground">
            {csvRowCount} row{csvRowCount !== 1 ? 's' : ''}
          </strong>{' '}
          detected · required fields auto-mapped
        </span>
      </div>

      {/* Saved mappings */}
      {savedMappings.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Load a saved mapping</p>
          <div className="flex flex-wrap gap-2">
            {savedMappings.map((saved) => (
              <Button
                key={saved.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onLoadSavedMapping(saved)}
              >
                {saved.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Column mapping table */}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Map columns to fields</p>
        <p className="text-xs text-muted-foreground">
          Required fields: First Name, Last Name
        </p>
      </div>

      <div
        className="overflow-hidden rounded-lg border bg-card"
        role="table"
        aria-label="Column mapping"
      >
        <div className="grid grid-cols-[1fr_40px_1fr] items-center gap-x-0 gap-y-0 text-sm">
          {/* Header row */}
          <div
            className="eyebrow border-b bg-muted/40 px-3.5 py-2.5"
            role="columnheader"
          >
            CSV column
          </div>
          <div
            className="border-b bg-muted/40 px-2 py-2.5"
            role="columnheader"
            aria-hidden="true"
          />
          <div
            className="eyebrow border-b bg-muted/40 px-3.5 py-2.5"
            role="columnheader"
          >
            System field
          </div>

          {/* Mapping rows */}
          {csvHeaders.map((header) => (
            <MappingRow
              key={header}
              csvHeader={header}
              currentValue={mapping[header] ?? ''}
              usedSystemFields={usedSystemFields}
              onChange={onMappingChange}
            />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          <span>Back</span>
        </Button>
        <Button
          type="button"
          onClick={onNext}
          disabled={!requiredFieldsMapped || isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>Generating preview…</span>
            </>
          ) : (
            <>
              <span>Preview</span>
              <ArrowRight className="size-4" aria-hidden="true" />
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

function MappingRow({
  csvHeader,
  currentValue,
  usedSystemFields,
  onChange,
}: {
  csvHeader: string
  currentValue: string
  usedSystemFields: Set<string>
  onChange: (csvHeader: string, systemField: string) => void
}) {
  return (
    <>
      <div className="border-b border-row-divider px-3.5 py-2.5 font-mono text-xs text-foreground">
        {csvHeader}
      </div>
      <div
        className="flex items-center justify-center border-b border-row-divider py-2.5 text-muted-foreground"
        aria-hidden="true"
      >
        <ChevronRight className="size-3.5 rtl:rotate-180" />
      </div>
      <div className="border-b border-row-divider px-3.5 py-2">
        <select
          value={currentValue}
          onChange={(e) => onChange(csvHeader, e.target.value)}
          className="h-[34px] w-full rounded-[8px] border border-input bg-card px-2.5 text-[12.5px] text-foreground outline-none transition-[color,box-shadow,border-color] focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15"
          aria-label={`Map "${csvHeader}" to system field`}
        >
          <option value="">— Skip —</option>
          {SYSTEM_FIELDS.map((field) => (
            <option
              key={field.value}
              value={field.value}
              disabled={
                usedSystemFields.has(field.value) &&
                currentValue !== field.value
              }
            >
              {field.label}
              {field.required ? ' *' : ''}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}

function PreviewStep({
  previewRows,
  validCount,
  invalidCount,
  totalRows,
  isLoading,
  onBack,
  onImport,
}: {
  previewRows: PreviewRow[]
  validCount: number
  invalidCount: number
  totalRows: number
  isLoading: boolean
  onBack: () => void
  onImport: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Summary — labels are explicit that the valid/invalid counts
          are drawn from the preview sample, not the whole file. Without
          that hedge users assume any "invalid" here reflects the entire
          import, which the counts don't measure. */}
      <div className="flex flex-wrap gap-5 rounded-[9px] border bg-muted/40 px-4 py-3 text-[13px]">
        <span>
          Total rows: <strong className="font-semibold">{totalRows}</strong>
        </span>
        <span className="text-brand-emphasis">
          Valid in preview: <strong className="font-semibold">{validCount}</strong>
          <span className="ml-1 text-xs text-muted-foreground">
            (of {previewRows.length} sampled)
          </span>
        </span>
        {invalidCount > 0 && (
          <span className="text-danger-foreground">
            Invalid in preview: <strong className="font-semibold">{invalidCount}</strong>
          </span>
        )}
      </div>

      {/* Preview table */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-[12.5px]" aria-label="Import preview">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="eyebrow px-3.5 py-2.5 text-left">Row</th>
              <th className="eyebrow px-3.5 py-2.5 text-left">Status</th>
              <th className="eyebrow px-3.5 py-2.5 text-left">First</th>
              <th className="eyebrow px-3.5 py-2.5 text-left">Last</th>
              <th className="eyebrow px-3.5 py-2.5 text-left">Email</th>
              <th className="eyebrow px-3.5 py-2.5 text-left">Details</th>
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row) => (
              <tr
                key={row.rowNumber}
                className="border-b border-row-divider last:border-b-0"
              >
                <td className="px-3.5 py-2.5 text-muted-foreground">
                  {row.rowNumber}
                </td>
                <td className="px-3.5 py-2.5">
                  {row.valid ? (
                    <Badge variant="brand" size="sm">
                      <CheckCircle2 className="size-3" aria-hidden="true" />
                      Valid
                    </Badge>
                  ) : (
                    <Badge variant="danger" size="sm">
                      <AlertCircle className="size-3" aria-hidden="true" />
                      Invalid
                    </Badge>
                  )}
                </td>
                <td className="px-3.5 py-2.5">{row.mapped.firstName || '—'}</td>
                <td className="px-3.5 py-2.5">{row.mapped.lastName || '—'}</td>
                <td className="px-3.5 py-2.5 text-muted-foreground">
                  {row.mapped.email || '—'}
                </td>
                <td className="px-3.5 py-2.5 text-xs text-muted-foreground">
                  {row.error ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {previewRows.length < totalRows && (
        <p className="text-xs text-muted-foreground">
          Showing first {previewRows.length} of {totalRows} rows
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          <span>Back to mapping</span>
        </Button>
        <Button type="button" onClick={onImport} disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>Importing…</span>
            </>
          ) : (
            <>
              <FileUp className="size-4" aria-hidden="true" />
              <span>Import {totalRows} rows</span>
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

function ResultStep({
  result,
  onReset,
}: {
  result: ImportResult
  onReset: () => void
}) {
  const hasErrors = result.errors.length > 0

  return (
    <div className="flex flex-col gap-4">
      {/* Summary card */}
      <div className="rounded-xl border border-brand/40 bg-brand-subtle/40 p-5">
        <div className="mb-4 flex items-center gap-2.5">
          <CheckCircle2
            className="size-5 text-brand-emphasis"
            aria-hidden="true"
          />
          <h3 className="text-[15px] font-semibold text-foreground">
            Import complete
          </h3>
        </div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Total rows</p>
            <p className="mt-1 text-[22px] font-semibold tnum text-foreground">
              {result.totalRows}
            </p>
          </div>
          <div>
            <p className="text-xs text-brand-emphasis">Imported</p>
            <p className="mt-1 text-[22px] font-semibold tnum text-brand-emphasis">
              {result.successCount}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">
              Skipped (duplicates)
            </p>
            <p className="mt-1 text-[22px] font-semibold tnum text-foreground">
              {result.skipCount}
            </p>
          </div>
        </div>
      </div>

      {/* Error details */}
      {hasErrors && (
        <details className="rounded-md border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-danger-foreground">
            {result.errors.length} row{result.errors.length !== 1 ? 's' : ''}{' '}
            skipped — click to see details
          </summary>
          <div className="max-h-48 overflow-y-auto border-t px-3 py-2">
            <ul className="space-y-1 text-xs">
              {result.errors.map((err) => (
                <li key={err.row} className="text-muted-foreground">
                  <span className="font-mono">Row {err.row}:</span>{' '}
                  {err.message}
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      {/* Actions */}
      <div className="pt-2">
        <Button type="button" variant="outline" onClick={onReset}>
          <span>Import another file</span>
        </Button>
      </div>
    </div>
  )
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

const MAX_CSV_FILE_SIZE = 10 * 1024 * 1024 // 10 MB — larger files should be split
const PREVIEW_ROW_LIMIT = 10

/**
 * Alias map from a normalized header string to a system field value.
 * The user-visible names have punctuation and spacing variance we can't
 * infer from the field key alone; this dictionary captures the common
 * forms exported by Salesforce, HubSpot, Excel, and spreadsheet-first
 * workflows so auto-mapping does the right thing without user input.
 */
const FIELD_ALIASES: Record<string, string> = {
  firstname: 'firstName',
  givenname: 'firstName',
  fname: 'firstName',
  lastname: 'lastName',
  surname: 'lastName',
  familyname: 'lastName',
  lname: 'lastName',
  fullname: 'firstName', // Split rarely; user can adjust
  email: 'email',
  emailaddress: 'email',
  workemail: 'email',
  primaryemail: 'email',
  altemail: 'altEmail',
  alternateemail: 'altEmail',
  secondaryemail: 'altEmail',
  personalemail: 'altEmail',
  phone: 'phone',
  phonenumber: 'phone',
  mobile: 'phone',
  mobilephone: 'phone',
  workphone: 'phone',
  jobtitle: 'title',
  title: 'title',
  position: 'title',
  role: 'title',
  description: 'description',
  notes: 'description',
  dealvalue: 'dealValue',
  amount: 'dealValue',
  value: 'dealValue',
  opportunityamount: 'dealValue',
  currency: 'currency',
  leadstatus: 'leadStatus',
  status: 'leadStatus',
  tier: 'tier',
  linkedin: 'linkedinUrl',
  linkedinurl: 'linkedinUrl',
  linkedinprofile: 'linkedinUrl',
  country: 'country',
  state: 'state',
  region: 'state',
  province: 'state',
  companyname: 'companyName',
  company: 'companyName',
  organization: 'companyName',
  account: 'companyName',
  accountname: 'companyName',
  companyindustry: 'companyIndustry',
  industry: 'companyIndustry',
  companywebsite: 'companyWebsite',
  website: 'companyWebsite',
  domain: 'companyWebsite',
  url: 'companyWebsite',
  stageid: 'stageId',
  stage: 'stageId',
}

/**
 * Lowercases and strips whitespace/punctuation from a CSV header so the
 * alias lookup matches variants like "First Name", "first_name", and
 * "First-Name" to the same normalized key.
 */
function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\s_\-.\/()]+/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function stepLabel(step: WizardStep): string {
  switch (step) {
    case 'upload':
      return 'Upload'
    case 'mapping':
      return 'Map columns'
    case 'preview':
      return 'Preview'
    case 'result':
      return 'Result'
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * RFC 4180 compliant CSV parser. Handles:
 *   - quoted fields containing commas
 *   - quoted fields containing newlines (\n, \r\n, \r)
 *   - escaped double-quotes ("") within quoted fields
 *   - trailing newlines
 *
 * Skips completely blank records so a file with a trailing newline
 * doesn't produce an extra empty row. Throws with a useful message if
 * an unclosed quote is detected.
 *
 * Exported for future test coverage of the parser edge cases.
 */
export function parseCsv(source: string): string[][] {
  const records: string[][] = []
  let current: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const len = source.length

  while (i < len) {
    const ch = source[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && source[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      current.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\r' || ch === '\n') {
      current.push(field)
      field = ''
      // Only push a record if it has any content — avoids blank trailing
      // record when the file ends with a newline.
      if (current.some((f) => f.length > 0)) {
        records.push(current.map((f) => f.trim()))
      }
      current = []
      // Consume a paired \r\n as a single line ending.
      if (ch === '\r' && i + 1 < len && source[i + 1] === '\n') {
        i += 2
      } else {
        i += 1
      }
      continue
    }
    field += ch
    i += 1
  }

  if (inQuotes) {
    throw new Error(
      'CSV parse error: unterminated quoted field. Check for a missing closing quote.',
    )
  }

  // Flush the final record.
  current.push(field)
  if (current.some((f) => f.length > 0)) {
    records.push(current.map((f) => f.trim()))
  }

  return records
}
