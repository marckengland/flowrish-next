'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * `useState` whose value is persisted to `localStorage` under `key`, so table
 * preferences (sort, page size, …) survive navigation and reloads.
 *
 * SSR-safe: the initial render always uses `initial` (matching the server
 * output), then the stored value is read once after mount. This avoids a
 * hydration mismatch at the cost of a single settling re-render. Writes are
 * skipped until after that first read so a fresh mount can't clobber the
 * stored value with the default.
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
): readonly [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial)
  const hydrated = useRef(false)

  // Load the persisted value once, after mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw !== null) setValue(JSON.parse(raw) as T)
    } catch {
      // Ignore malformed / unavailable storage — fall back to `initial`.
    } finally {
      hydrated.current = true
    }
    // Only re-run if the storage key itself changes.
  }, [key])

  // Persist on change, but not before the initial read (so we don't overwrite
  // a stored value with the default on first mount).
  useEffect(() => {
    if (!hydrated.current) return
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Ignore quota / unavailable storage.
    }
  }, [key, value])

  return [value, setValue] as const
}
