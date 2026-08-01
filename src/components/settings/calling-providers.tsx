'use client'

import { useEffect, useState } from 'react'
import {
  Check,
  ExternalLink,
  Minus,
  Phone,
  PhoneCall,
  Sparkles,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const STORAGE_KEY = 'flowrish:voice-provider'

interface Provider {
  id: string
  name: string
  /** Short, punchy positioning line. */
  pitch: string
  /** Indicative US outbound per-minute rate. */
  rate: string
  /** Marketing badge shown top-right. */
  tag?: { label: string; tone: 'recommended' | 'value' | 'neutral' }
  /** In-browser (WebRTC) calling SDK available. */
  webrtc: boolean
  pros: string[]
  cons: string[]
  href: string
}

/**
 * Indicative US outbound voice rates (2026). Rates change frequently and
 * vary by destination/volume — always confirm on the provider's own
 * pricing page before committing.
 */
const PROVIDERS: readonly Provider[] = [
  {
    id: 'twilio',
    name: 'Twilio',
    pitch: 'The industry standard. If in doubt, start here.',
    rate: '≈ $0.014 / min',
    tag: { label: 'Recommended', tone: 'recommended' },
    webrtc: true,
    pros: [
      'Best-in-class reliability, docs & tooling',
      'Huge ecosystem and third-party integrations',
      'Global coverage + programmable everything (Voice SDK, recording, transcription)',
    ],
    cons: [
      'Priciest per minute of the bunch',
      'Costs add up quickly at high call volume',
      'Feature sprawl can be overwhelming to set up',
    ],
    href: 'https://www.twilio.com/en-us/voice',
  },
  {
    id: 'telnyx',
    name: 'Telnyx',
    pitch: 'Carrier-owned network at roughly half the price.',
    rate: '≈ $0.007 / min',
    tag: { label: 'Best value', tone: 'value' },
    webrtc: true,
    pros: [
      '~50% cheaper than Twilio per minute',
      'Owns its network → sub-200ms latency',
      'Solid JS / React Native WebRTC SDKs',
    ],
    cons: [
      'Smaller ecosystem than Twilio',
      'Fewer off-the-shelf third-party integrations',
    ],
    href: 'https://telnyx.com/products/voice-api',
  },
  {
    id: 'signalwire',
    name: 'SignalWire',
    pitch: 'Twilio-compatible API — the easiest switch.',
    rate: '≈ $0.003 / min (SIP)',
    tag: { label: 'Easiest switch', tone: 'neutral' },
    webrtc: true,
    pros: [
      'Near drop-in: Twilio-compatible API means minimal code changes',
      'Very low per-minute rates over SIP',
      'Built by telecom + FreeSWITCH veterans',
    ],
    cons: [
      'Smaller community and support footprint',
      'Dashboard/tooling less polished than Twilio',
    ],
    href: 'https://signalwire.com',
  },
  {
    id: 'plivo',
    name: 'Plivo',
    pitch: 'Twilio-like flexibility, lower sticker price.',
    rate: '≈ $0.012 / min',
    tag: { label: 'Budget pick', tone: 'neutral' },
    webrtc: true,
    pros: [
      'Cheaper than Twilio with a familiar, simple API',
      'Browser SDK for in-app calling',
      'Strong global deliverability',
    ],
    cons: [
      'Fewer advanced/edge features',
      'Smaller ecosystem than Twilio',
    ],
    href: 'https://www.plivo.com/voice/',
  },
  {
    id: 'bandwidth',
    name: 'Bandwidth',
    pitch: 'Owns the network — cheapest at real volume.',
    rate: 'Volume-based',
    tag: { label: 'Best at scale', tone: 'neutral' },
    webrtc: true,
    pros: [
      'Lowest cost once call volume is high',
      'Direct carrier (no middleman markup)',
      'Strong compliance & enterprise support',
    ],
    cons: [
      'Enterprise onboarding, less self-serve',
      'Overkill for small teams / low volume',
    ],
    href: 'https://www.bandwidth.com/communications-apis/voice/',
  },
]

/**
 * Calling & Voice settings.
 *
 * Explains Flowrish's built-in, zero-cost click-to-call and lets the org
 * compare and pick a voice provider for future in-browser calling. The
 * pick is remembered locally (no credentials are stored here) so teams can
 * line up their choice before wiring in the provider's SDK.
 */
export function CallingProviders(): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    try {
      setSelected(window.localStorage.getItem(STORAGE_KEY))
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  }, [])

  function choose(id: string): void {
    setSelected(id)
    try {
      window.localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Built-in click-to-call banner */}
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col gap-3 bg-brand-subtle/40 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand text-brand-foreground"
            >
              <PhoneCall className="size-[18px]" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  Click-to-call is already on
                </h3>
                <Badge variant="brand" size="sm">
                  Active · Free
                </Badge>
              </div>
              <p className="mt-0.5 max-w-[560px] text-[13px] text-muted-foreground">
                Every lead with a phone number has a{' '}
                <span className="font-medium text-foreground">Call</span> button
                that launches your device dialer and logs the call to the
                timeline — no provider, no per-minute cost. Connect a provider
                below to unlock in-browser calling, recording and transcription.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Choose a voice provider
          </h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            For in-app calling. Pick the one that fits your budget and volume —
            you can change this anytime.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {PROVIDERS.map((p) => {
          const isSelected = selected === p.id
          return (
            <div
              key={p.id}
              className={cn(
                'flex flex-col rounded-xl border bg-card p-5 transition-shadow',
                isSelected
                  ? 'border-brand ring-1 ring-brand'
                  : 'hover:shadow-[0_6px_18px_-10px_rgba(0,0,0,0.2)]',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-muted text-foreground"
                  >
                    <Phone className="size-[17px]" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-[15px] font-semibold">{p.name}</h4>
                      {isSelected && (
                        <Badge variant="brand" size="sm">
                          Your pick
                        </Badge>
                      )}
                    </div>
                    <p className="text-[12.5px] text-muted-foreground">{p.pitch}</p>
                  </div>
                </div>
                {p.tag && <ProviderTag tag={p.tag} />}
              </div>

              {/* Rate + capability chips */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-[12px] font-medium tnum text-foreground">
                  {p.rate}
                </span>
                {p.webrtc && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-subtle px-2.5 py-1 text-[11px] font-medium text-brand-emphasis">
                    <Check className="size-3" aria-hidden="true" />
                    In-browser calling
                  </span>
                )}
              </div>

              {/* Pros / cons */}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <ul className="flex flex-col gap-1.5">
                  {p.pros.map((pro) => (
                    <li key={pro} className="flex gap-2 text-[12.5px] text-foreground/80">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-brand-emphasis" aria-hidden="true" />
                      {pro}
                    </li>
                  ))}
                </ul>
                <ul className="flex flex-col gap-1.5">
                  {p.cons.map((con) => (
                    <li key={con} className="flex gap-2 text-[12.5px] text-muted-foreground">
                      <Minus className="mt-0.5 size-3.5 shrink-0 text-danger-foreground" aria-hidden="true" />
                      {con}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Actions */}
              <div className="mt-5 flex items-center gap-2 border-t border-row-divider pt-4">
                <Button
                  type="button"
                  size="sm"
                  variant={isSelected ? 'outline' : 'default'}
                  onClick={() => choose(p.id)}
                >
                  {isSelected ? (
                    <>
                      <Check className="size-4" aria-hidden="true" />
                      Selected
                    </>
                  ) : (
                    'Select'
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  nativeButton={false}
                  render={
                    <a href={p.href} target="_blank" rel="noopener noreferrer" />
                  }
                >
                  Pricing & docs
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      <p className="flex items-start gap-2 text-[12px] text-muted-foreground">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand-emphasis" aria-hidden="true" />
        Rates are indicative US outbound prices (2026) and change often —
        confirm current pricing on each provider&apos;s site. Selecting a
        provider records your preference; connecting credentials to place calls
        in-browser is the next setup step.
      </p>
    </div>
  )
}

function ProviderTag({
  tag,
}: {
  tag: NonNullable<Provider['tag']>
}): React.JSX.Element {
  if (tag.tone === 'recommended') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-[11px] font-semibold text-brand-foreground">
        <Sparkles className="size-3" aria-hidden="true" />
        {tag.label}
      </span>
    )
  }
  return (
    <Badge variant={tag.tone === 'value' ? 'warning' : 'outline'} size="sm" className="shrink-0">
      {tag.label}
    </Badge>
  )
}
