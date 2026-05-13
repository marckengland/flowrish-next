'use client'

import { useCallback, useMemo, useState } from 'react'
import { FileUp, Loader2, CheckCircle2, AlertCircle, ArrowRight, ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'

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

      setIsLoading(true)
      try {
        const text = await file.text()
        if (!text.trim()) {
          setError('The file is empty')
          return
        }

        // Parse headers from first line
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
        if (lines.length < 2) {
          setError('CSV must have a header row and at least one data row')
          return
        }

        const headers = parseCSVLine(lines[0])
        setCsvContent(text)
        setCsvHeaders(headers)
        setCsvRowCount(lines.length - 1) // Exclude header
        setFileName(file.name)

        // Auto-map columns that match system field names (case-insensitive)
        const autoMapping: Record<string, string> = {}
        for (const header of headers) {
          const normalized = header.toLowerCase().replace(/[\s_-]+/g, '')
          const match = SYSTEM_FIELDS.find(
            (f) => f.value.toLowerCase() === normalized,
          )
          if (match) {
            autoMapping[header] = match.value
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
      // Client-side preview: parse and validate first few rows locally
      const lines = csvContent
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
      const dataLines = lines.slice(1, 11) // Preview up to 10 rows
      const headers = parseCSVLine(lines[0])

      const rows: PreviewRow[] = dataLines.map((line, index) => {
        const values = parseCSVLine(line)
        const mapped: Record<string, string> = {}

        for (const [csvHeader, systemField] of Object.entries(mapping)) {
          const headerIndex = headers.indexOf(csvHeader)
          if (headerIndex >= 0 && values[headerIndex] !== undefined) {
            mapped[systemField] = values[headerIndex]
          }
        }

        // Basic validation: check required fields
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
        <ol className="flex items-center gap-2 text-sm">
          {(['upload', 'mapping', 'preview', 'result'] as const).map(
            (s, i) => (
              <li key={s} className="flex items-center gap-2">
                {i > 0 && (
                  <span className="text-muted-foreground" aria-hidden="true">
                    →
                  </span>
                )}
                <span
                  className={
                    step === s
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground'
                  }
                  aria-current={step === s ? 'step' : undefined}
                >
                  {i + 1}. {stepLabel(s)}
                </span>
              </li>
            ),
          )}
        </ol>
      </nav>

      {/* Error display */}
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
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
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-8">
      <FileUp className="size-10 text-muted-foreground" aria-hidden="true" />
      <div className="text-center">
        <p className="text-sm font-medium">Upload a CSV file</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The file should have a header row with column names
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
      <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          {fileName} — {csvRowCount} row{csvRowCount !== 1 ? 's' : ''} detected
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
        className="overflow-x-auto rounded-md border"
        role="table"
        aria-label="Column mapping"
      >
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 gap-y-0 text-sm">
          {/* Header row */}
          <div className="border-b bg-muted/50 px-3 py-2 font-medium" role="columnheader">
            CSV Column
          </div>
          <div className="border-b bg-muted/50 px-3 py-2" role="columnheader" aria-hidden="true">
            →
          </div>
          <div className="border-b bg-muted/50 px-3 py-2 font-medium" role="columnheader">
            System Field
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
      <div className="border-b px-3 py-2 font-mono text-xs">{csvHeader}</div>
      <div className="border-b px-3 py-2 text-muted-foreground" aria-hidden="true">
        →
      </div>
      <div className="border-b px-3 py-2">
        <select
          value={currentValue}
          onChange={(e) => onChange(csvHeader, e.target.value)}
          className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
      {/* Summary */}
      <div className="flex flex-wrap gap-4 rounded-md border bg-muted/30 px-4 py-3 text-sm">
        <span>
          Total rows: <strong>{totalRows}</strong>
        </span>
        <span className="text-green-600 dark:text-green-400">
          Preview valid: <strong>{validCount}</strong>
        </span>
        {invalidCount > 0 && (
          <span className="text-destructive">
            Preview invalid: <strong>{invalidCount}</strong>
          </span>
        )}
      </div>

      {/* Preview table */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm" aria-label="Import preview">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left font-medium">Row</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">First Name</th>
              <th className="px-3 py-2 text-left font-medium">Last Name</th>
              <th className="px-3 py-2 text-left font-medium">Email</th>
              <th className="px-3 py-2 text-left font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row) => (
              <tr key={row.rowNumber} className="border-b last:border-b-0">
                <td className="px-3 py-2 text-muted-foreground">
                  {row.rowNumber}
                </td>
                <td className="px-3 py-2">
                  {row.valid ? (
                    <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="size-3.5" aria-hidden="true" />
                      Valid
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <AlertCircle className="size-3.5" aria-hidden="true" />
                      Invalid
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {row.mapped.firstName || '—'}
                </td>
                <td className="px-3 py-2">
                  {row.mapped.lastName || '—'}
                </td>
                <td className="px-3 py-2">
                  {row.mapped.email || '—'}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
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
      <div className="rounded-md border bg-muted/30 p-4">
        <div className="flex items-center gap-2">
          <CheckCircle2
            className="size-5 text-green-600 dark:text-green-400"
            aria-hidden="true"
          />
          <h3 className="font-medium">Import complete</h3>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Total rows</p>
            <p className="text-lg font-semibold">{result.totalRows}</p>
          </div>
          <div>
            <p className="text-green-600 dark:text-green-400">Imported</p>
            <p className="text-lg font-semibold">{result.successCount}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Skipped</p>
            <p className="text-lg font-semibold">{result.skipCount}</p>
          </div>
        </div>
      </div>

      {/* Error details */}
      {hasErrors && (
        <details className="rounded-md border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-destructive">
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

/**
 * Simple CSV line parser that handles quoted fields.
 * Handles commas within quoted fields and escaped double-quotes.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote (doubled)
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // Skip next quote
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        fields.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
  }

  fields.push(current.trim())
  return fields
}
