/**
 * Right-column "Deal" card for the lead detail page.
 *
 * Groups the commercial fields (status, tier, stage, value, currency, score)
 * into a compact data card in the aside, so the main lead-info panel stays
 * focused on identity/contact details instead of spreading these across a
 * wide, mostly-empty form. Presentational only — no client state.
 */
export interface LeadDealCardProps {
  leadStatus: string | null | undefined
  tier: string | null | undefined
  stageName?: string | null
  dealValue: string | number | null | undefined
  currency: string | null | undefined
  score: number | null | undefined
}

export function LeadDealCard({
  leadStatus,
  tier,
  stageName,
  dealValue,
  currency,
  score,
}: LeadDealCardProps): React.JSX.Element {
  return (
    <section
      aria-label="Deal details"
      className="flex flex-col gap-3 rounded-lg border bg-card p-[18px]"
    >
      <h2 className="text-sm font-semibold">Deal</h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 text-sm">
        <Item label="Lead Status" value={prettyStatus(leadStatus)} />
        <Item label="Tier" value={prettyTier(tier)} />
        <Item label="Deal Stage" value={stageName ?? null} />
        <Item
          label="Deal Value"
          value={formatCurrency(dealValue, currency ?? 'USD')}
          numeric
        />
        <Item label="Currency" value={currency ?? null} />
        <Item label="Score" value={score != null ? String(score) : null} />
      </dl>
    </section>
  )
}

function Item({
  label,
  value,
  numeric = false,
}: {
  label: string
  value: string | null
  numeric?: boolean
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <dt className="eyebrow">{label}</dt>
      <dd
        className={
          numeric
            ? 'tnum text-sm font-semibold text-foreground'
            : 'text-sm text-foreground'
        }
      >
        {value === null || value === '' ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

function prettyStatus(status: string | null | undefined): string | null {
  if (!status) return null
  return status.charAt(0) + status.slice(1).toLowerCase()
}

function prettyTier(tier: string | null | undefined): string | null {
  if (!tier) return null
  switch (tier) {
    case 'TIER_1':
      return 'Tier 1'
    case 'TIER_2':
      return 'Tier 2'
    case 'TIER_3':
      return 'Tier 3'
    default:
      return tier
  }
}

function formatCurrency(
  value: string | number | null | undefined,
  currency: string,
): string | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${currency} ${n}`
  }
}
