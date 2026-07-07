'use client'

import { useEffect, useState } from 'react'

/**
 * Returns a debounced copy of `value` that only updates after `delayMs`
 * has elapsed without any further change. Useful for search inputs where
 * we don't want to re-fetch on every keystroke.
 *
 * The debounce timer is reset every time `value` changes; if the component
 * unmounts mid-flight the pending timeout is cleared, so consumers don't
 * need to guard against stale state updates.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value)
      return
    }
    const handle = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(handle)
  }, [value, delayMs])

  return debounced
}
