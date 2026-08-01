import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight,
  Calendar,
  GitBranchPlus,
  Zap,
  TrendingUp,
  Bot,
  Check,
} from 'lucide-react'

import { createSupabaseServer } from '@/lib/supabase/server'
import { DashboardMockup } from '@/components/marketing/dashboard-mockup'
import { PricingSection } from '@/components/marketing/pricing-section'

export const metadata = {
  title: 'Flowrish — The CRM that does the busywork',
  description:
    'Flowrish automates logging, follow-ups, lead scoring and forecasting, then hands every rep the single highest-value action to take next.',
}

/**
 * Public marketing landing page ("/").
 *
 * Server Component: performs a lightweight auth check so the nav + hero
 * CTAs point signed-in visitors straight to the app, and everyone else
 * into the sign-up / sign-in funnel.
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
    // Supabase not configured (local/dev) — treat as logged out.
    isAuthed = false
  }

  const getStartedHref = isAuthed ? '/dashboard' : '/onboarding'
  const primaryLabel = isAuthed ? 'Open app' : 'Get started'

  return (
    <div className="min-h-screen bg-card text-foreground">
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
                Product
              </a>
              <a href="#features" className="transition-colors hover:text-foreground">
                Features
              </a>
              <a href="#pricing" className="transition-colors hover:text-foreground">
                Pricing
              </a>
              <a href="#how" className="transition-colors hover:text-foreground">
                Docs
              </a>
            </div>
          </div>
          <div className="flex items-center gap-3.5">
            {isAuthed ? (
              <Link
                href="/dashboard"
                className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] bg-brand px-[18px] text-[14px] font-semibold text-brand-foreground transition-colors hover:bg-brand-hover"
              >
                Open app
                <ArrowRight className="size-[15px]" aria-hidden="true" />
              </Link>
            ) : (
              <>
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
              </>
            )}
          </div>
        </nav>

        {/* HERO */}
        <section className="grid items-center gap-14 px-6 py-16 sm:px-14 lg:grid-cols-[1.02fr_1.18fr]">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[12px] font-medium tracking-[0.06em] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-brand" />
              REVENUE PLATFORM FOR SALES TEAMS
            </div>
            <h1 className="mb-6 text-[54px] font-bold leading-[0.98] tracking-[-0.035em] text-balance sm:text-[66px]">
              Sell more.
              <br />
              Admin less.
            </h1>
            <p className="mb-8 max-w-[480px] text-[19px] leading-[1.55] text-muted-foreground">
              Flowrish automates the busywork — logging activity, sending
              follow-ups, scoring leads and building your forecast — then hands
              every rep the single highest-value action to take next. Your team
              closes; the CRM keeps itself up to date.
            </p>
            <div className="mb-5 flex flex-wrap items-center gap-3.5">
              <Link
                href={getStartedHref}
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand px-6 text-[16px] font-semibold text-brand-foreground transition-colors hover:bg-brand-hover"
              >
                {primaryLabel}
                <ArrowRight className="size-[17px]" aria-hidden="true" />
              </Link>
              <a
                href="mailto:sales@flowrish.com"
                className="inline-flex h-12 items-center gap-2 rounded-xl border px-6 text-[16px] font-semibold transition-colors hover:bg-muted"
              >
                <Calendar className="size-4" aria-hidden="true" />
                Book a demo
              </a>
            </div>
            <p className="font-mono text-[13px] text-muted-foreground">
              No credit card required · 14-day trial · SOC 2 Type II
            </p>
          </div>
          <DashboardMockup />
        </section>

        {/* FEATURES */}
        <section id="features" className="scroll-mt-20 px-6 pb-6 pt-2 sm:px-14">
          <div className="mb-11 max-w-[620px]">
            <div className="mb-3.5 font-mono text-[12px] tracking-[0.08em] text-muted-foreground">
              01 — WHAT FLOWRISH DOES
            </div>
            <h2 className="mb-4 text-[42px] font-bold leading-[1.05] tracking-[-0.03em]">
              Every part of the deal, handled.
            </h2>
            <p className="text-[17px] leading-[1.55] text-muted-foreground">
              Pipeline, cadences, prioritization, forecasting and AI — one
              system that runs itself so your reps can run their deals.
            </p>
          </div>

          {/* hero feature: Rhythm */}
          <div className="mb-5 grid items-center gap-10 rounded-2xl border bg-background p-10 lg:grid-cols-2">
            <div>
              <div className="mb-3.5 inline-flex items-center gap-2 text-[13px] font-semibold">
                <TrendingUp className="size-[18px]" aria-hidden="true" />
                RHYTHM ENGINE
              </div>
              <h3 className="mb-3.5 text-[30px] font-bold leading-[1.1] tracking-[-0.02em]">
                The right action, ranked every morning.
              </h3>
              <p className="mb-[18px] text-[16px] leading-[1.55] text-muted-foreground">
                Flowrish scores every open deal by value, urgency and
                engagement, then builds a ranked to-do list. No more guessing
                what to work on — reps open Flowrish and start closing.
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

          {/* 2x2 feature grid */}
          <div className="grid gap-5 lg:grid-cols-2">
            <FeatureCard
              icon={<GitBranchPlus className="size-[17px]" aria-hidden="true" />}
              eyebrow="PIPELINE"
              title="See every deal at a glance"
              body="Drag deals across stages on a kanban board. Values, scores and owners update everywhere, instantly."
            />
            <FeatureCard
              icon={<Zap className="size-[17px]" aria-hidden="true" />}
              eyebrow="CADENCES"
              title="Follow-ups that send themselves"
              body="Build multi-step sequences once. Flowrish schedules the tasks, threads the emails and never lets a lead go cold."
            />
            <FeatureCard
              icon={<TrendingUp className="size-[17px]" aria-hidden="true" />}
              eyebrow="FORECASTING"
              title="A forecast you can commit to"
              body="Weighted pipeline, AI prediction and commit-vs-actual — side by side, so there are no surprises at quarter close."
            />
            <FeatureCard
              icon={<Bot className="size-[17px]" aria-hidden="true" />}
              eyebrow="AI ASSIST"
              title="Draft emails & research in a click"
              body="Personalized outreach, instant account research and an in-app assistant — grounded in your own pipeline data."
            />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how" className="scroll-mt-20 px-6 pb-6 pt-14 sm:px-14">
          <div className="mb-3.5 font-mono text-[12px] tracking-[0.08em] text-muted-foreground">
            02 — HOW IT WORKS
          </div>
          <h2 className="mb-11 max-w-[560px] text-[42px] font-bold leading-[1.05] tracking-[-0.03em]">
            Live in an afternoon.
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
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
          <div className="relative overflow-hidden rounded-3xl bg-[oklch(0.17_0_0)] px-8 py-[72px] text-center text-white sm:px-14">
            <h2 className="mx-auto mb-4 max-w-[640px] text-[40px] font-bold leading-[1.03] tracking-[-0.03em] text-balance sm:text-[48px]">
              Give your reps their time back.
            </h2>
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
  eyebrow,
  title,
  body,
}: {
  icon: React.ReactNode
  eyebrow: string
  title: string
  body: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col rounded-2xl border p-8">
      <div className="mb-3 inline-flex items-center gap-2 text-[13px] font-semibold">
        {icon}
        {eyebrow}
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

