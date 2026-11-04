import { Card, CardContent } from '@/components/ui/card'
import type { ForecastHistoryReport } from '@/lib/forecast-basis'

const money = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value)
const month = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const timestamp = (value: string) => new Date(value).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' })
const cell = 'whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums'

export function ForecastHistory({ report, error = false }: { report: ForecastHistoryReport | null; error?: boolean }) {
  if (error) return <div role="alert" className="rounded-lg border p-5 text-sm">Could not load forecast history. <a className="underline" href="/forecast">Reload history</a></div>
  if (!report) return <p role="status" className="p-5 text-sm text-muted-foreground">Loading forecast history…</p>
  return <div className="min-w-0 space-y-[18px]">
    <Card><CardContent className="min-w-0 p-5">
      <h2 className="text-sm font-semibold">Your monthly results</h2>
      <p className="mt-1 text-xs text-muted-foreground">Your assigned deals · USD · UTC · last six months</p>
      <p className="mt-2 text-xs text-muted-foreground">Current CRM won revenue, loaded {timestamp(report.asOf)}. Totals can change after reassignment, reopening, or edits. Attainment uses positive commitments only.</p>
      <div className="relative mt-4 max-w-full overflow-x-auto">
        <table aria-label="Monthly forecast results" className="w-full min-w-[720px] text-left text-xs">
          <thead className="border-b text-muted-foreground"><tr>{['Month', 'Your commitment', 'Won revenue', 'Difference', 'Attainment', 'Status'].map(label => <th key={label} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{label}</th>)}</tr></thead>
          <tbody>{report.months.map(row => <tr key={row.period} className="border-b last:border-0">
            <th scope="row" className="whitespace-nowrap px-3 py-3 font-medium">{month(row.period)}</th>
            <td className={cell}>{money(row.commitAmount)}{row.submittedAt && <span className="mt-1 block font-sans text-[10px] text-muted-foreground">Submitted {timestamp(row.submittedAt)}</span>}</td>
            <td className={cell}>{money(row.wonRevenue)}</td>
            <td className={cell}>{row.delta !== null && row.delta > 0 ? '+' : ''}{money(row.delta)}</td>
            <td className={cell}>{row.attainment === null ? '—' : `${row.attainment.toFixed(1)}%`}</td>
            <td className="min-w-[150px] px-3 py-3 text-muted-foreground">
              {row.basisStatus === 'unverified' ? 'Unverified commitment' : row.basisStatus === 'incompatible' ? 'Different reporting basis' : row.basisStatus === 'missing' ? 'No commitment' : 'Comparable'}
              {row.inProgress && <span className="mt-1 block text-foreground">Month in progress</span>}
            </td>
          </tr>)}</tbody>
        </table>
      </div>
    </CardContent></Card>
    <Card><CardContent className="min-w-0 p-5">
      <h2 className="text-sm font-semibold">Business snapshots</h2>
      <p className="mt-1 text-xs text-muted-foreground">Latest 30 daily whole-business snapshots from this reporting window, shown separately from your personal commitments. Legacy and different-basis amounts stay hidden.</p>
      {report.snapshots.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No business snapshots yet.</p> : <div className="relative mt-4 max-w-full overflow-x-auto">
        <table aria-label="Business snapshot history" className="w-full min-w-[720px] text-left text-xs">
          <thead className="border-b text-muted-foreground"><tr>{['Captured (UTC)', 'Month', 'Reporting basis', 'Total pipeline', 'Weighted', 'Predicted'].map(label => <th key={label} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{label}</th>)}</tr></thead>
          <tbody>{report.snapshots.map(row => <tr key={row.id} className="border-b last:border-0">
            <th scope="row" className="whitespace-nowrap px-3 py-3 font-normal">{timestamp(row.snapshotDate)}</th>
            <td className="whitespace-nowrap px-3 py-3">{month(row.period)}</td>
            <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{row.basisStatus === 'verified' ? 'USD · UTC · calculation v1' : row.basisStatus === 'unverified' ? 'Unverified legacy snapshot' : 'Different reporting basis'}</td>
            <td className={cell}>{money(row.totalPipeline)}</td><td className={cell}>{money(row.weightedPipeline)}</td><td className={cell}>{money(row.aiPredicted)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </CardContent></Card>
  </div>
}
