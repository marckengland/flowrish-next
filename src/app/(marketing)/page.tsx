import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ArrowRight,
  Calendar,
  GitBranchPlus,
  Mail,
  Workflow,
  TrendingUp,
  Bot,
  Check,
} from 'lucide-react'

import type { Metadata } from 'next'

import { createSupabaseServer } from '@/lib/supabase/server'
import { siteConfig } from '@/lib/site'
import { DashboardMockup } from '@/components/marketing/dashboard-mockup'
import { CadenceFlow } from '@/components/marketing/cadence-flow'
import { PricingSection } from '@/components/marketing/pricing-section'
import { WaitlistForm } from '@/components/marketing/waitlist-form'
import { isWaitlistEnabled } from '@/lib/waitlist'

export const metadata: Metadata = {
  title: siteConfig.title,
  description: siteConfig.description,
  alternates: { canonical: '/' },
}

/**
 * JSON-LD for the entity graph + product understanding by search / AI
 * engines. Rendered server-side in the initial HTML.
 */
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${siteConfig.url}/#website`,
      url: `${siteConfig.url}/`,
      name: siteConfig.name,
      description: siteConfig.description,
    },
    {
      '@type': 'Organization',
      '@id': `${siteConfig.url}/#organization`,
      name: siteConfig.name,
      url: `${siteConfig.url}/`,
      ...(siteConfig.sameAs.length ? { sameAs: siteConfig.sameAs } : {}),
    },
    {
      '@type': 'SoftwareApplication',
      name: `${siteConfig.name} CRM`,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: siteConfig.description,
      url: `${siteConfig.url}/`,
    },
  ],
}

/**
 * Public marketing landing page ("/").
 *
 * Server Component: signed-in visitors are sent straight to the app, so the
 * landing page only ever renders for logged-out visitors. Everyone here is
 * funneled into the sign-up / sign-in flow.
 */
export default async function LandingPage(): Promise<React.JSX.Element> {
  let isAuthed = false
  try {
    const supabase = await createSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    isAuthed = Boolean(user)
  } catch {
    // Supabase not configured (local/dev) — treat as logged out and render
    // the public landing page.
    isAuthed = false
  }

  // Signed-in visitors go straight to the app. Called outside the try/catch
  // above because redirect() signals via a thrown NEXT_REDIRECT error that
  // must not be swallowed.
  if (isAuthed) redirect('/dashboard')

  // Waitlist feature flag (WAITLIST_ENABLED, default on). When enabled, CTAs
  // funnel to the waitlist anchor (/onboarding stays reachable for invited
  // testers). When disabled, CTAs go straight to open signup.
  const waitlistEnabled = isWaitlistEnabled()
  const getStartedHref = waitlistEnabled ? '#waitlist' : '/onboarding'
  const primaryLabel = waitlistEnabled ? 'Join the waitlist' : 'Get started'

  return (
    <div className="min-h-screen bg-card text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <div className="mx-auto max-w-[1280px]">
        {/* NAV */}
        <nav className="sticky top-0 z-10 flex h-[68px] items-center justify-between border-b bg-card/85 px-6 backdrop-blur sm:px-10">
          <div className="flex items-center gap-11">
            <Link href="/" className="flex items-center gap-2.5">
              <Image
                src="/flower-emerald.png"
                alt=""
                width={20}
                height={20}
                className="size-5 object-contain"
              />
              <span className="text-[17px] font-semibold tracking-[-0.01em]">
                Flowrish
              </span>
            </Link>
            <div className="hidden items-center gap-[30px] text-[14px] text-muted-foreground md:flex">
              <a href="#features" className="transition-colors hover:text-foreground">
                Features
              </a>
              <a href="#how" className="transition-colors hover:text-foreground">
                How it works
              </a>
              <a href="#pricing" className="transition-colors hover:text-foreground">
                Pricing
              </a>
            </div>
          </div>
          <div className="flex items-center gap-3.5">
            <Link
              href="/login"
              className="text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              href={getStartedHref}
              className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] bg-brand px-[18px] text-[14px] font-semibold text-brand-foreground transition-colors hover:bg-brand-hover"
            >
              Get started
              <ArrowRight className="size-[15px]" aria-hidden="true" />
            </Link>
          </div>
        </nav>

        {/* HERO */}
        <section className="relative grid items-center gap-14 px-6 py-16 sm:px-14 lg:grid-cols-[1.02fr_1.18fr]">
          {/* Soft on-brand emerald wash for depth. Subtle, not a neon glow. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 left-0 -z-0 h-[420px] w-[520px] rounded-full bg-brand/[0.07] blur-[90px]"
          />
          <div className="relative">
            <div className="rise mb-6 inline-flex items-center rounded-full border px-3.5 py-1.5 font-mono text-[12px] font-medium tracking-[0.04em] text-muted-foreground">
              CRM for sales teams
            </div>
            <h1 className="rise rise-1 mb-6 text-[54px] font-bold leading-[0.98] tracking-[-0.035em] text-balance sm:text-[66px]">
              Sell more.
              <br />
              Admin less.
            </h1>
            <p className="rise rise-2 mb-8 max-w-[480px] text-[19px] leading-[1.55] text-muted-foreground">
              Flowrish automates the busywork and hands every rep their single
              highest-value next action. Your reps close; the CRM keeps itself
              current.
            </p>
            <div className="rise rise-3 mb-5 flex flex-wrap items-center gap-3.5">
              <Link
                href={getStartedHref}
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand px-6 text-[16px] font-semibold text-brand-foreground transition-[background-color,transform] hover:bg-brand-hover active:translate-y-px"
              >
                {primaryLabel}
                <ArrowRight className="size-[17px]" aria-hidden="true" />
              </Link>
              <a
                href="mailto:sales@flowrish.com"
                className="inline-flex h-12 items-center gap-2 rounded-xl border px-6 text-[16px] font-semibold transition-[background-color,transform] hover:bg-muted active:translate-y-px"
              >
                <Calendar className="size-4" aria-hidden="true" />
                Book a demo
              </a>
            </div>
            <p className="rise rise-4 font-mono text-[13px] text-muted-foreground">
              {waitlistEnabled
                ? "Private beta. We'll email you the moment a spot opens."
                : 'No credit card required. 14-day trial.'}
            </p>
          </div>
          <div className="rise rise-2 relative">
            <DashboardMockup />
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" className="scroll-mt-20 px-6 pb-6 pt-6 sm:px-14">
          <div className="reveal mb-11 max-w-[620px]">
            <h2 className="mb-4 text-[42px] font-bold leading-[1.05] tracking-[-0.03em]">
              Every part of the deal, handled.
            </h2>
            <p className="text-[17px] leading-[1.55] text-muted-foreground">
              Pipeline, cadences, prioritization, forecasting and AI in one
              system that runs itself, so your reps can run their deals.
            </p>
          </div>

          {/* hero feature: Rhythm */}
          <div className="reveal mb-5 grid items-center gap-10 rounded-2xl border bg-background p-10 lg:grid-cols-2">
            <div>
              <div className="mb-4 inline-flex items-center gap-2.5 text-[14px] font-semibold text-brand-emphasis">
                <span className="flex size-8 items-center justify-center rounded-lg bg-brand-subtle text-brand-emphasis">
                  <TrendingUp className="size-[18px]" aria-hidden="true" />
                </span>
                Rhythm engine
              </div>
              <h3 className="mb-3.5 text-[30px] font-bold leading-[1.1] tracking-[-0.02em]">
                The right action, ranked every morning.
              </h3>
              <p className="mb-[18px] text-[16px] leading-[1.55] text-muted-foreground">
                Flowrish scores every open deal by value, urgency and
                engagement, then builds a ranked to-do list. No more guessing
                what to work on. Reps open Flowrish and start closing.
              </p>
              <ul className="flex flex-col gap-2.5 text-[15px] text-foreground/80">
                {[
                  'Priority scoring across the whole pipeline',
                  'Deal-health and gap detection',
                  'Overdue and at-risk alerts',
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2.5">
                    <Check className="size-[17px] shrink-0 text-brand" aria-hidden="true" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="overflow-hidden rounded-xl border bg-card shadow-[0_20px_44px_-26px_rgba(0,0,0,0.28)]">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <span className="text-[13px] font-semibold">Today&apos;s Rhythm</span>
                <span className="font-mono text-[11px] text-muted-foreground">27 open</span>
              </div>
              <RhythmRow score="92" tone="danger" title="Call about renewal" meta="Acme Corp · Overdue" />
              <RhythmRow score="64" tone="warning" title="Send proposal follow-up" meta="Globex Inc · Due today" />
              <RhythmRow score="31" tone="neutral" title="Log discovery-call notes" meta="Initech · Due Jul 29" last />
            </div>
          </div>

          {/* featured: Cadence flow (visual left / text right, zigzag) */}
          <div className="reveal mb-5 grid items-center gap-10 py-4 lg:grid-cols-2">
            <div className="lg:order-2">
              <div className="mb-4 inline-flex items-center gap-2.5 text-[14px] font-semibold text-brand-emphasis">
                <span className="flex size-8 items-center justify-center rounded-lg bg-brand-subtle text-brand-emphasis">
                  <Workflow className="size-[18px]" aria-hidden="true" />
                </span>
                Cadences
              </div>
              <h3 className="mb-3.5 text-[30px] font-bold leading-[1.1] tracking-[-0.02em]">
                Design the whole sequence, then let it run.
              </h3>
              <p className="mb-[18px] text-[16px] leading-[1.55] text-muted-foreground">
                Map every touch on a visual flow: email, LinkedIn, calls and
                tasks, with the timing between them. Enroll a lead and Flowrish
                works the steps on schedule.
              </p>
              <ul className="flex flex-col gap-2.5 text-[15px] text-foreground/80">
                {[
                  'Email, LinkedIn, call and task steps',
                  'Per-step delays with send-time windows',
                  'Follow-ups threaded into Gmail automatically',
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2.5">
                    <Check className="size-[17px] shrink-0 text-brand" aria-hidden="true" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="lg:order-1">
              <CadenceFlow />
            </div>
          </div>

          {/* 2x2 feature grid */}
          <div className="reveal grid gap-5 lg:grid-cols-2">
            <FeatureCard
              icon={<GitBranchPlus className="size-[17px]" aria-hidden="true" />}
              label="Pipeline"
              title="See every deal at a glance"
              body="Drag deals across stages on a kanban board. Values, scores and owners update everywhere, instantly."
            />
            <FeatureCard
              icon={<Mail className="size-[17px]" aria-hidden="true" />}
              label="Email & calls"
              title="Every conversation, logged"
              body="Two-way Gmail sync keeps threads on the deal and click-to-call captures calls, so activity logs itself."
            />
            <FeatureCard
              icon={<TrendingUp className="size-[17px]" aria-hidden="true" />}
              label="Forecasting"
              title="A forecast you can commit to"
              body="Weighted pipeline, AI prediction and commit-vs-actual, side by side, so quarter close holds no surprises."
            />
            <FeatureCard
              icon={<Bot className="size-[17px]" aria-hidden="true" />}
              label="AI assist"
              title="Draft emails and research in a click"
              body="Personalized outreach, instant account research and an in-app assistant, all grounded in your own pipeline data."
            />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how" className="scroll-mt-20 px-6 pb-6 pt-14 sm:px-14">
          <h2 className="reveal mb-11 max-w-[560px] text-[42px] font-bold leading-[1.05] tracking-[-0.03em]">
            Live in an afternoon.
          </h2>
          <div className="reveal grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { n: '01', t: 'Connect & import', d: 'Link Gmail and import leads by CSV. Duplicates are caught and merged automatically.', first: true },
              { n: '02', t: 'Score & prioritize', d: "Flowrish ranks every deal and builds each rep's daily rhythm the moment data lands." },
              { n: '03', t: 'Automate outreach', d: 'Enroll leads in cadences. Follow-up emails and tasks fire on schedule, threaded in Gmail.' },
              { n: '04', t: 'Forecast & commit', d: 'Compare your commit against the AI prediction and close the quarter with confidence.' },
            ].map((s) => (
              <div
                key={s.n}
                className={`border-t-2 pt-5 ${s.first ? 'border-foreground' : 'border-border'}`}
              >
                <div className="mb-3.5 font-mono text-[13px] text-muted-foreground">{s.n}</div>
                <h4 className="mb-2 text-[18px] font-semibold tracking-[-0.01em]">{s.t}</h4>
                <p className="text-[14.5px] leading-[1.5] text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* PRICING */}
        <PricingSection getStartedHref={getStartedHref} />

        {/* FINAL CTA */}
        <section className="px-6 py-10 sm:px-10">
          <div
            id="waitlist"
            className="reveal relative scroll-mt-24 overflow-hidden rounded-3xl bg-[oklch(0.17_0_0)] px-8 py-[72px] text-center text-white sm:px-14"
          >
            <h2 className="mx-auto mb-4 max-w-[640px] text-[40px] font-bold leading-[1.03] tracking-[-0.03em] text-balance sm:text-[48px]">
              Give your reps their time back.
            </h2>
            {waitlistEnabled ? (
              <>
                <p className="mx-auto mb-8 max-w-[520px] text-[18px] leading-[1.5] text-white/70">
                  Flowrish is in private beta. Join the waitlist and we&apos;ll
                  email you the moment a spot opens. Set up in an afternoon and
                  let it run the admin so your team can run the deals.
                </p>
                <WaitlistForm tone="dark" />
                <p className="mt-6 text-[14px] text-white/60">
                  Prefer a walkthrough?{' '}
                  <a
                    href="mailto:sales@flowrish.com"
                    className="font-semibold text-white underline-offset-4 hover:underline"
                  >
                    Book a demo
                  </a>
                  {' · '}
                  Already a tester?{' '}
                  <Link
                    href="/login"
                    className="font-semibold text-white underline-offset-4 hover:underline"
                  >
                    Sign in
                  </Link>
                </p>
              </>
            ) : (
              <>
                <p className="mx-auto mb-8 max-w-[520px] text-[18px] leading-[1.5] text-white/70">
                  Set up Flowrish in an afternoon and let it run the admin so your
                  team can run the deals.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3.5">
                  <Link
                    href={getStartedHref}
                    className="inline-flex h-[50px] items-center gap-2 rounded-xl bg-white px-7 text-[16px] font-semibold text-[oklch(0.17_0_0)] transition-opacity hover:opacity-90"
                  >
                    {primaryLabel}
                    <ArrowRight className="size-[17px]" aria-hidden="true" />
                  </Link>
                  <a
                    href="mailto:sales@flowrish.com"
                    className="inline-flex h-[50px] items-center rounded-xl border border-white/25 px-6 text-[16px] font-semibold text-white transition-colors hover:bg-white/10"
                  >
                    Book a demo
                  </a>
                </div>
              </>
            )}
          </div>
        </section>

        {/* FOOTER */}
        <footer className="grid gap-8 border-t px-6 pb-13 pt-11 sm:grid-cols-2 sm:px-14 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="mb-3.5 flex items-center gap-2.5">
              <Image
                src="/flower-emerald.png"
                alt=""
                width={19}
                height={19}
                className="size-[19px] object-contain"
              />
              <span className="text-[16px] font-semibold">Flowrish</span>
            </div>
            <p className="max-w-[230px] text-[13.5px] leading-[1.5] text-muted-foreground">
              The CRM that does the busywork, so your team can sell.
            </p>
          </div>
          <FooterCol title="Product" links={['Pipeline', 'Cadences', 'Forecasting']} />
          <FooterCol title="Company" links={['About', 'Careers', 'Contact']} />
          <FooterCol title="Legal" links={['Privacy', 'Terms', 'Security']} />
        </footer>
      </div>
    </div>
  )
}

function FeatureCard({
  icon,
  label,
  title,
  body,
}: {
  icon: React.ReactNode
  label: string
  title: string
  body: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col rounded-2xl border p-8 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-28px_rgba(0,0,0,0.3)]">
      <div className="mb-4 inline-flex items-center gap-2.5 text-[14px] font-semibold text-brand-emphasis">
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand-subtle text-brand-emphasis">
          {icon}
        </span>
        {label}
      </div>
      <h3 className="mb-2 text-[22px] font-bold tracking-[-0.02em]">{title}</h3>
      <p className="text-[15px] leading-[1.5] text-muted-foreground">{body}</p>
    </div>
  )
}

function FooterCol({
  title,
  links,
}: {
  title: string
  links: string[]
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2.5 text-[13.5px]">
      <span className="mb-0.5 font-semibold">{title}</span>
      {links.map((l) => (
        <a key={l} href="#" className="text-muted-foreground transition-colors hover:text-foreground">
          {l}
        </a>
      ))}
    </div>
  )
}

function RhythmRow({
  score,
  tone,
  title,
  meta,
  last,
}: {
  score: string
  tone: 'danger' | 'warning' | 'neutral'
  title: string
  meta: string
  last?: boolean
}): React.JSX.Element {
  const toneClass =
    tone === 'danger'
      ? 'bg-danger-subtle text-danger-foreground'
      : tone === 'warning'
        ? 'bg-warning-subtle text-warning-foreground'
        : 'bg-muted text-muted-foreground'
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${last ? '' : 'border-b border-row-divider'}`}>
      <span className={`flex size-[34px] items-center justify-center rounded-full text-[12px] font-bold tnum ${toneClass}`}>
        {score}
      </span>
      <div className="flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="text-[11px] text-muted-foreground">{meta}</div>
      </div>
    </div>
  )
}

