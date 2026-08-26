'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Check, Download, Loader2, Radar, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Keyless lead discovery UI (OpenStreetMap). Search businesses by location +
 * category/keyword, then import selected ones as Company records (each with a
 * saved leadgen Insight). Backed by /api/lead-discovery/{search,import}.
 */

// Kept in sync with CATEGORY_FILTERS in src/lib/web/overpass.ts. Duplicated
// here because that module is server-only and can't be imported client-side.
const CATEGORIES = [
  'restaurant',
  'cafe',
  'bar',
  'hotel',
  'shop',
  'supermarket',
  'office',
  'clinic',
  'pharmacy',
  'gym',
  'bank',
  'school',
  'car_dealer',
] as const

interface Business {
  osmType: string
  osmId: number
  name: string
  category: string | null
  address: string | null
  phone: string | null
  website: string | null
  lat: number | null
  lon: number | null
}

const bizKey = (b: Business): string => `${b.osmType}/${b.osmId}`

export function LeadDiscovery(): React.JSX.Element {
  const [location, setLocation] = useState('')
  const [category, setCategory] = useState('')
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<Business[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [searching, startSearch] = useTransition()
  const [importing, startImport] = useTransition()

  function runSearch(): void {
    if (!location.trim() || searching) return
    setError(null)
    setImportMsg(null)
    startSearch(async () => {
      try {
        const res = await fetch('/api/lead-discovery/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            location,
            category: category || undefined,
            keyword: keyword || undefined,
          }),
        })
        const body = (await res.json().catch(() => ({}))) as {
          data?: Business[]
          error?: { message?: string }
        }
        if (!res.ok) {
          setError(body.error?.message ?? `Search failed (${res.status})`)
          return
        }
        const data = body.data ?? []
        setResults(data)
        setSelected(new Set(data.map(bizKey))) // pre-select all
        setSearched(true)
      } catch {
        setError('Search failed. Please try again.')
      }
    })
  }

  function toggle(key: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleAll(): void {
    setSelected((prev) =>
      prev.size === results.length ? new Set() : new Set(results.map(bizKey)),
    )
  }

  function importSelected(): void {
    const businesses = results.filter((b) => selected.has(bizKey(b)))
    if (businesses.length === 0 || importing) return
    setError(null)
    setImportMsg(null)
    startImport(async () => {
      try {
        const res = await fetch('/api/lead-discovery/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ businesses }),
        })
        const body = (await res.json().catch(() => ({}))) as {
          data?: { created: number; skipped: number }
          error?: { message?: string }
        }
        if (!res.ok || !body.data) {
          setError(body.error?.message ?? `Import failed (${res.status})`)
          return
        }
        setImportMsg(
          `Imported ${body.data.created} compan${body.data.created === 1 ? 'y' : 'ies'}` +
            (body.data.skipped
              ? `, skipped ${body.data.skipped} (already existed).`
              : '.'),
        )
      } catch {
        setError('Import failed. Please try again.')
      }
    })
  }

  const allSelected = results.length > 0 && selected.size === results.length

  return (
    <div className="flex flex-col gap-4">
      {/* Search form */}
      <div className="grid grid-cols-1 gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[2fr_1fr_1fr_auto]">
        <div>
          <label htmlFor="ld-location" className="mb-1 block text-xs font-medium">
            Location <span className="text-danger-foreground">*</span>
          </label>
          <input
            id="ld-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            placeholder="e.g. Makati, Philippines"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ld-category" className="mb-1 block text-xs font-medium">
            Category
          </label>
          <select
            id="ld-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
          >
            <option value="">Any business</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ld-keyword" className="mb-1 block text-xs font-medium">
            Name contains
          </label>
          <input
            id="ld-keyword"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            placeholder="optional"
            className={inputClass}
          />
        </div>
        <div className="flex items-end">
          <Button type="button" onClick={runSearch} disabled={searching || !location.trim()}>
            {searching ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="size-4" aria-hidden="true" />
            )}
            <span>{searching ? 'Searching…' : 'Search'}</span>
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger-foreground">
          {error}
        </p>
      ) : null}
      {importMsg ? (
        <p className="flex items-center gap-1.5 text-sm text-brand-emphasis">
          <Check className="size-4" aria-hidden="true" />
          {importMsg}{' '}
          <Link href="/companies" className="underline hover:no-underline">
            View companies
          </Link>
        </p>
      ) : null}

      {/* Results */}
      {results.length > 0 ? (
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span>
                {selected.size} of {results.length} selected
              </span>
            </label>
            <Button
              type="button"
              size="sm"
              onClick={importSelected}
              disabled={importing || selected.size === 0}
            >
              {importing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="size-4" aria-hidden="true" />
              )}
              <span>{importing ? 'Importing…' : `Import ${selected.size}`}</span>
            </Button>
          </div>
          <ul className="divide-y divide-row-divider">
            {results.map((b) => {
              const key = bizKey(b)
              const isSel = selected.has(key)
              return (
                <li key={key} className="flex items-start gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggle(key)}
                    className="mt-1"
                    aria-label={`Select ${b.name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{b.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[b.category, b.address, b.phone].filter(Boolean).join(' · ') ||
                        'No extra details'}
                    </p>
                    {b.website ? (
                      <a
                        href={b.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brand-emphasis underline hover:no-underline"
                      >
                        {b.website}
                      </a>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : searched && !searching ? (
        <p className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No businesses found. Try a broader location or a different category.
        </p>
      ) : (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
          <Radar className="size-5 text-brand-emphasis" aria-hidden="true" />
          <p>
            Search for local businesses by location and category, then add the
            ones you want as companies.
          </p>
        </div>
      )}
    </div>
  )
}

const inputClass = cn(
  'flex h-10 w-full rounded-[10px] border border-input bg-card px-3 py-1 text-sm text-foreground shadow-sm transition-[color,box-shadow,border-color] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15',
)
