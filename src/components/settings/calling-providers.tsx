'use client'

import { useEffect, useState } from 'react'
import {
  Check,
  ExternalLink,
  KeyRound,
  Loader2,
  Minus,
  Phone,
  PhoneCall,
  Sparkles,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { TwilioCredentialsForm } from '@/components/settings/twilio-credentials-form'

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
  const [saving, setSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Load the org-wide selection.
  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/voice-provider', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.provider !== 'undefined') {
          setSelected(data.provider ?? null)
        }
      })
      .catch(() => {
        // Non-fatal — the grid still renders, just without a saved pick.
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function choose(id: string): Promise<void> {
    setSaveError(null)
    setSaving(id)
    const previous = selected
    setSelected(id) // optimistic
    try {
      const res = await fetch('/api/admin/voice-provider', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: id }),
      })
      if (!res.ok) {
        setSelected(previous)
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setSaveError(body.error?.message ?? 'Could not save your choice.')
      }
    } catch {
      setSelected(previous)
      setSaveError('Could not save your choice.')
    } finally {
      setSaving(null)
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
          <p className="mt-0.5 max-w-[640px] text-[13px] text-muted-foreground">
            For in-app calling. Pick the one that fits your budget and volume —
            you can change this anytime. All of these connect with{' '}
            <span className="font-medium text-foreground">API keys</span> (none
            use OAuth sign-in) — expand{' '}
            <span className="font-medium text-foreground">How to connect</span>{' '}
            on any card for step-by-step links to each credential.
          </p>
        </div>
      </div>

      {saveError && (
        <p role="alert" className="text-[13px] text-danger-foreground">
          {saveError}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {PROVIDERS.map((p) => {
          const isSelected = selected === p.id
          return (
            <div
              key={p.id}
              className={cn(
                'flex flex-col rounded-xl border bg-card p-5 transition-[box-shadow,background-color,border-color]',
                isSelected
                  ? 'border-brand bg-brand-subtle/30 ring-1 ring-brand'
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
                  disabled={saving !== null}
                >
                  {saving === p.id ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Saving…
                    </>
                  ) : isSelected ? (
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

              <ProviderSetup providerId={p.id} />
            </div>
          )
        })}
      </div>

      {selected === 'twilio' && <TwilioCredentialsForm />}

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

interface SetupStep {
  text: string
  href?: string
  hrefLabel?: string
  /** Flowrish env var this step produces (Twilio only). */
  env?: string
}

interface SetupGuide {
  /** How the provider authenticates. */
  auth: string
  /** Whether Flowrish can place calls in-browser with this provider today. */
  live: boolean
  consoleHref: string
  consoleLabel: string
  steps: SetupStep[]
  /** Env vars to add to the Flowrish deployment (Twilio). */
  envVars?: { name: string; desc: string }[]
}

/**
 * Per-provider connection guides. Every provider here authenticates with
 * API keys/tokens — none use an OAuth "Sign in with…" flow — so the steps
 * point directly at the console page where each credential lives.
 */
const SETUP_GUIDES: Record<string, SetupGuide> = {
  twilio: {
    auth: 'API keys (Account SID + API Key/Secret). No OAuth.',
    live: true,
    consoleHref: 'https://console.twilio.com',
    consoleLabel: 'Open Twilio Console',
    steps: [
      {
        text: 'Create a free Twilio account (or sign in).',
        href: 'https://www.twilio.com/try-twilio',
        hrefLabel: 'Sign up',
      },
      {
        text: 'Buy a voice-enabled phone number — this is the number calls come from.',
        href: 'https://console.twilio.com/us1/develop/phone-numbers/manage/search',
        hrefLabel: 'Buy a number',
        env: 'Caller ID field',
      },
      {
        text: 'Copy your Account SID from the Console dashboard.',
        href: 'https://console.twilio.com',
        hrefLabel: 'Account dashboard',
        env: 'Account SID field',
      },
      {
        text: 'Create an API Key — save the SID and Secret (the Secret is shown once).',
        href: 'https://console.twilio.com/us1/account/keys-credentials/api-keys',
        hrefLabel: 'Create API key',
        env: 'API Key SID + Secret fields',
      },
      {
        text: 'Create a TwiML App and set its Voice “Request URL” to the webhook URL shown in the form below, then copy its SID.',
        href: 'https://console.twilio.com/us1/develop/voice/manage/twiml-apps',
        hrefLabel: 'Create TwiML App',
        env: 'TwiML App SID field',
      },
      {
        text: 'Paste all five values into the “Connect your Twilio account” form below and save — they’re stored encrypted for your workspace only.',
      },
    ],
  },
  telnyx: {
    auth: 'API key (V2). No OAuth.',
    live: false,
    consoleHref: 'https://portal.telnyx.com',
    consoleLabel: 'Open Telnyx Portal',
    steps: [
      {
        text: 'Sign up for / sign in to the Telnyx Mission Control Portal.',
        href: 'https://portal.telnyx.com/#/signup',
        hrefLabel: 'Sign up',
      },
      {
        text: 'Create an API Key (your name, top-right → API Keys).',
        href: 'https://portal.telnyx.com/#/app/api-keys',
        hrefLabel: 'API Keys',
      },
      {
        text: 'Buy a number and create a Voice API Application / WebRTC credential.',
        href: 'https://developers.telnyx.com/development/api-fundamentals/create-api-keys',
        hrefLabel: 'Docs',
      },
    ],
  },
  signalwire: {
    auth: 'Project ID + API Token + Space URL. No OAuth.',
    live: false,
    consoleHref: 'https://signalwire.com/signin',
    consoleLabel: 'Open SignalWire',
    steps: [
      {
        text: 'Create a SignalWire Space (or sign in).',
        href: 'https://signalwire.com/signin',
        hrefLabel: 'Sign in',
      },
      {
        text: 'In your Space, open the API tab to copy your Project ID, API Token and Space URL.',
        href: 'https://developers.signalwire.com/platform/dashboard/getting-started/your-signalwire-api-space',
        hrefLabel: 'API credentials guide',
      },
      { text: 'Buy a voice-capable phone number in your Space.' },
    ],
  },
  plivo: {
    auth: 'Auth ID + Auth Token. No OAuth.',
    live: false,
    consoleHref: 'https://console.plivo.com',
    consoleLabel: 'Open Plivo Console',
    steps: [
      {
        text: 'Sign up for / sign in to the Plivo Console.',
        href: 'https://console.plivo.com',
        hrefLabel: 'Console',
      },
      {
        text: 'Copy your Auth ID and Auth Token from the dashboard overview.',
        href: 'https://console.plivo.com/dashboard/',
        hrefLabel: 'Dashboard',
      },
      { text: 'Buy a number and create a Voice application.' },
    ],
  },
  bandwidth: {
    auth: 'API credentials (username/password) + Account ID. No OAuth.',
    live: false,
    consoleHref: 'https://dashboard.bandwidth.com',
    consoleLabel: 'Open Bandwidth Dashboard',
    steps: [
      {
        text: 'Request an account — Bandwidth onboards through sales.',
        href: 'https://www.bandwidth.com/communications-apis/voice/',
        hrefLabel: 'Get started',
      },
      {
        text: 'In the dashboard, find your API credentials and Account ID.',
        href: 'https://dashboard.bandwidth.com',
        hrefLabel: 'Dashboard',
      },
      { text: 'Provision voice-capable numbers for outbound calling.' },
    ],
  },
}

function ProviderSetup({ providerId }: { providerId: string }): React.JSX.Element | null {
  const guide = SETUP_GUIDES[providerId]
  if (!guide) return null
  return (
    <details className="mt-4 rounded-[10px] border bg-background/60">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-[13px] font-medium text-foreground">
        <KeyRound className="size-3.5 text-muted-foreground" aria-hidden="true" />
        How to connect
        {guide.live ? (
          <Badge variant="brand" size="sm" className="ml-auto">
            Ready to use
          </Badge>
        ) : (
          <Badge variant="outline" size="sm" className="ml-auto">
            Integration coming soon
          </Badge>
        )}
      </summary>
      <div className="border-t px-4 py-3.5">
        <p className="mb-3 text-[12.5px] text-muted-foreground">
          <span className="font-medium text-foreground">Authentication:</span>{' '}
          {guide.auth}
        </p>
        <ol className="flex flex-col gap-2.5">
          {guide.steps.map((s, i) => (
            <li key={i} className="flex gap-2.5 text-[12.5px]">
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-[20px] shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px] font-semibold tnum text-foreground"
              >
                {i + 1}
              </span>
              <span className="text-foreground/80">
                {s.text}
                {s.env && (
                  <span className="ml-1 font-mono text-[11px] text-brand-emphasis">
                    → {s.env}
                  </span>
                )}
                {s.href && (
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1.5 inline-flex items-center gap-0.5 font-medium text-brand-emphasis hover:underline"
                  >
                    {s.hrefLabel ?? 'Open'}
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                )}
              </span>
            </li>
          ))}
        </ol>

        {guide.envVars && (
          <div className="mt-3.5 rounded-[8px] border bg-card p-3">
            <p className="mb-2 text-[12px] font-medium text-foreground">
              Add these to your Flowrish environment, then select Twilio above:
            </p>
            <ul className="flex flex-col gap-1">
              {guide.envVars.map((v) => (
                <li key={v.name} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                    {v.name}
                  </code>
                  <span className="text-muted-foreground">{v.desc}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <a
          href={guide.consoleHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-emphasis hover:underline"
        >
          {guide.consoleLabel}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </div>
    </details>
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
