'use client'

import Link from 'next/link'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'
import { PLAN_TIERS, PUBLIC_PRICING_MESSAGE } from '@/lib/plans'

export interface PricingSectionProps {
  /** Where the plan CTAs point (e.g. /onboarding, or /dashboard when signed in). */
  getStartedHref: string
  primaryLabel?: string
  /** Optional real contact destination; hide the enterprise CTA when absent. */
  talkToSalesHref?: string
}

/** Public plan information with pricing confirmed by the team. */
export function PricingSection({
  getStartedHref,
  primaryLabel = 'Get started',
  talkToSalesHref,
}: PricingSectionProps): React.JSX.Element {
  // Tiers + feature lists come from the shared plan source of truth
  // (src/lib/plans.ts), which the server-side entitlement guard reads too.
  const tiers = PLAN_TIERS

  return (
    <section id="pricing" className="scroll-mt-20 px-6 py-14 sm:px-14">
      <div className="reveal mb-10 flex flex-wrap items-end justify-between gap-5">
        <div>
          <h2 className="max-w-[560px] text-[42px] font-bold leading-[1.05] tracking-[-0.03em]">
            Plans for your team.
          </h2>
        </div>
      </div>

      <div className="reveal grid items-start gap-5 lg:grid-cols-3">
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className={cn(
              'flex flex-col rounded-2xl border p-[30px]',
              tier.featured
                ? 'border-[1.5px] border-brand shadow-[0_24px_50px_-30px_rgba(0,0,0,0.4)]'
                : 'border-border',
            )}
          >
            <div className="mb-1.5 text-[15px] font-semibold">{tier.name}</div>
            <p className="mb-[18px] text-[13.5px] leading-[1.45] text-muted-foreground">
              {tier.blurb}
            </p>

            <p className="mb-[22px] text-[18px] font-semibold leading-snug">
              {PUBLIC_PRICING_MESSAGE}
            </p>

            {(tier.slug !== 'enterprise' || talkToSalesHref) && (
              <Link
                href={
                  tier.slug === 'enterprise' ? talkToSalesHref! : getStartedHref
                }
                className={cn(
                  'mb-[22px] flex h-[42px] items-center justify-center rounded-[10px] text-[14px] font-semibold transition-[background-color,transform] active:translate-y-px',
                  tier.featured
                    ? 'bg-brand text-brand-foreground hover:bg-brand-hover'
                    : 'border border-border hover:bg-muted',
                )}
              >
                {tier.slug === 'enterprise' ? 'Talk to sales' : primaryLabel}
              </Link>
            )}

            <ul className="flex flex-col gap-2.5 text-[14px] text-foreground/80">
              {tier.features.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <Check
                    className={cn(
                      'mt-0.5 size-4 shrink-0',
                      tier.featured ? 'text-brand' : 'text-muted-foreground',
                    )}
                    aria-hidden="true"
                  />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
