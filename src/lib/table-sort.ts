export type SortDir = 'asc' | 'desc'

const collator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
})

/**
 * Compares two arbitrary cell values for table sorting.
 *
 * - Empty values (null/undefined/'') always sort last, regardless of direction.
 * - Numbers compare numerically; everything else compares as a locale-aware,
 *   numeric-aware string via `Intl.Collator` so "Item 2" precedes "Item 10".
 *
 * The comparator is always ascending; callers flip the result for descending
 * so empties stay pinned to the bottom either way.
 */
export function compareValues(a: unknown, b: unknown): number {
  const aEmpty = a === null || a === undefined || a === ''
  const bEmpty = b === null || b === undefined || b === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1

  if (typeof a === 'number' && typeof b === 'number') return a - b

  return collator.compare(String(a), String(b))
}

/**
 * Returns a new array sorted by the value produced by `getValue`. Empties are
 * kept at the bottom in both directions (descending flips only the non-empty
 * ordering). Pure and stable enough for client-side list sorting.
 */
export function sortByKey<T>(
  rows: readonly T[],
  getValue: (row: T) => unknown,
  dir: SortDir,
): T[] {
  const withEmpty: T[] = []
  const withValue: T[] = []
  for (const row of rows) {
    const v = getValue(row)
    if (v === null || v === undefined || v === '') withEmpty.push(row)
    else withValue.push(row)
  }
  withValue.sort((x, y) => compareValues(getValue(x), getValue(y)))
  if (dir === 'desc') withValue.reverse()
  return [...withValue, ...withEmpty]
}
