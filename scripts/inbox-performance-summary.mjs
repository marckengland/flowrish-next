const scenarios = [
  'counts',
  'counts literal search',
  'Pending page 1',
  'Pending literal search',
  'Approved overdue shortcut',
  'Pending Load more with retained draft',
  'Approved deadline order',
]

/** Render only complete synthetic results; timings are never a release threshold. */
export function formatInboxPerformanceSummary(results) {
  const rows = results?.report
  const expected = new Set([1000, 10000].flatMap(size => scenarios.map(scenario => `${size}:${scenario}`)))
  if (!Array.isArray(rows) || rows.length !== expected.size) throw new Error('Invalid synthetic performance summary.')
  for (const row of rows) {
    if (!row || !expected.delete(`${row.size}:${row.scenario}`) ||
      ![row.medianMs, row.p95Ms].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) ||
      !Number.isInteger(row.taskRows) || row.taskRows < 0 || row.taskRows > 200) {
      throw new Error('Invalid synthetic performance summary.')
    }
  }
  return [
    '## Synthetic inbox regressions passed',
    '',
    'Counts, pagination, retained drafts, bounded task reads, and callback duplicate/race checks passed on disposable data. Timings are informational; no wall-time threshold is enforced.',
    '',
    '| Follow-ups | Operation | Median ms | p95 ms | Task rows |',
    '| ---: | --- | ---: | ---: | ---: |',
    ...rows.map(row => `| ${row.size} | ${row.scenario} | ${row.medianMs.toFixed(2)} | ${row.p95Ms.toFixed(2)} | ${row.taskRows} |`),
    '',
  ].join('\n')
}
