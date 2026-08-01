'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

interface Tier {
  name: string
  blurb: string
  /** Monthly + annual per-seat prices, or null for "Custom". */
  price: { monthly: string; annual: string } | null
  customPrice?: string
  subLabelCustom?: string
  cta: { label: string; href: string; solid?: boolean }
  features: string[]
  featured?: boolean
}

export interface PricingSectionProps {
  /** Where the plan CTAs point (e.g. /onboarding, or /dashboard when signed in). */
  getStartedHref: string
  /** Where the enterprise "Talk to sales" CTA points. */
  talkToSalesHref?: string
}

/**
 * Marketing pricing block with an interactive Monthly/Annual toggle,
 * matching the landing prototype (Starter / Growth featured / Enterprise).
 */
export function PricingSection({
  getStartedHref,
  talkToSalesHref = 'mailto:sales@flowrish.com',
}: PricingSectionProps): React.JSX.Element {
  const [annual, setAnnual] = useState(true)

  const tiers: Tier[] = [
    {
      name: 'Starter',
      blurb: 'For small teams getting organized.',
      price: { monthly: '$24', annual: '$19' },
      cta: { label: 'Get started', href: getStartedHref },
      features: [
        'Lead & contact management',
        'Kanban pipeline',
        'CSV import / export',
      ],
    },
    {
      name: 'Growth',
      blurb: 'Automation and forecasting for scaling teams.',
      price: { monthly: '$59', annual: '$49' },
      cta: { label: 'Get started', href: getStartedHref, solid: true },
      features: [
        'Everything in Starter',
        'Cadences & Rhythm engine',
        'Revenue forecasting',
        'AI email & research',
      ],
      featured: true,
    },
    {
      name: 'Enterprise',
      blurb: 'Governance and control for large orgs.',
      price: null,
      customPrice: 'Custom',
      subLabelCustom: 'Volume & annual terms',
      cta: { label: 'Talk to sales', href: talkToSalesHref },
      features: [
        'Everything in Growth',
        'Custom roles & SSO',
        'Audit log & SLAs',
      ],
    },
  ]

  const billLabel = annual ? 'Billed annually' : 'Billed monthly'

  return (
    <section id="pricing" className="scroll-mt-20 px-6 py-14 sm:px-14">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="mb-3.5 font-mono text-[12px] tracking-[0.08em] text-muted-foreground">
            03 — PRICING
          </div>
          <h2 className="max-w-[520px] text-[42px] font-bold leading-[1.05] tracking-[-0.03em]">
            Priced per seat. No admin tax.
          </h2>
        </div>
        <div className="inline-flex items-center gap-1 rounded-[11px] bg-muted p-1">
          <button
            type="button"
            onClick={() => setAnnual(false)}
            aria-pressed={!annual}
            className={cn(
              'rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-colors',
              !annual
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground',
            )}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setAnnual(true)}
            aria-pressed={annual}
            className={cn(
              'rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-colors',
              annual
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground',
            )}
          >
            Annual <span className="opacity-70">−20%</span>
          </button>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-3">
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
            {tier.featured && (
              <div className="mb-3.5 inline-block w-fit rounded-full bg-foreground px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.04em] text-background">
                MOST POPULAR
              </div>
            )}
            <div className="mb-1.5 text-[15px] font-semibold">{tier.name}</div>
            <p className="mb-[18px] text-[13.5px] leading-[1.45] text-muted-foreground">
              {tier.blurb}
            </p>

            <div className="mb-1 flex items-baseline gap-1.5">
              <span className="tnum text-[40px] font-bold tracking-[-0.03em]">
                {tier.price ? (annual ? tier.price.annual : tier.price.monthly) : tier.customPrice}
              </span>
              {tier.price && (
                <span className="text-[14px] text-muted-foreground">/seat/mo</span>
              )}
            </div>
            <div className="mb-[22px] text-[12px] text-muted-foreground">
              {tier.price ? billLabel : tier.subLabelCustom}
            </div>

            <Link
              href={tier.cta.href}
              className={cn(
                'mb-[22px] flex h-[42px] items-center justify-center rounded-[10px] text-[14px] font-semibold transition-colors',
                tier.cta.solid
                  ? 'bg-brand text-brand-foreground hover:bg-brand-hover'
                  : 'border border-border hover:bg-muted',
              )}
            >
              {tier.cta.label}
            </Link>

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
