'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Menu, X } from 'lucide-react'

import { cn } from '@/lib/utils'

const SECTION_LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#how', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
] as const

export interface MarketingNavProps {
  /** Where the primary CTA points (waitlist anchor or /onboarding). */
  getStartedHref: string
  /** Primary CTA label ("Join the waitlist" or "Get started"). */
  primaryLabel: string
}

/**
 * Public landing-page top navigation.
 *
 * Desktop (md+): logo + section links + "Sign in" + primary CTA.
 * Mobile (<md): logo + primary CTA + a hamburger that opens a dropdown
 * panel with the section links and "Sign in" — previously these were
 * `hidden md:flex` with no mobile affordance, leaving the anchors
 * unreachable except by scrolling.
 *
 * Client component so the mobile menu can hold open/close state; the
 * server page passes the waitlist-derived CTA href/label as props.
 */
export function MarketingNav({
  getStartedHref,
  primaryLabel,
}: MarketingNavProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  // Close on Escape for parity with the app's drawer/dialog behaviour.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <nav className="sticky top-0 z-20 border-b bg-card/85 backdrop-blur">
      <div className="flex h-[68px] items-center justify-between px-6 sm:px-10">
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
            {SECTION_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3.5">
          {/* Desktop auth + CTA. On mobile these move into the menu panel so
              the bar stays uncramped (logo + hamburger only). */}
          <Link
            href="/login"
            className="hidden text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground md:inline"
          >
            Sign in
          </Link>
          <Link
            href={getStartedHref}
            className="hidden h-[38px] items-center gap-1.5 rounded-[10px] bg-brand px-[18px] text-[14px] font-semibold text-brand-foreground transition-[background-color,transform] hover:bg-brand-hover active:translate-y-px md:inline-flex"
          >
            {primaryLabel}
            <ArrowRight className="size-[15px]" aria-hidden="true" />
          </Link>

          {/* Mobile menu toggle */}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="marketing-mobile-menu"
            className="flex size-9 items-center justify-center rounded-[10px] text-foreground/70 transition-colors hover:bg-muted md:hidden"
          >
            {open ? (
              <X className="size-5" aria-hidden="true" />
            ) : (
              <Menu className="size-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown panel */}
      <div
        id="marketing-mobile-menu"
        className={cn('border-t md:hidden', open ? 'block' : 'hidden')}
      >
        <div className="flex flex-col gap-1 px-6 py-3 sm:px-10">
          {SECTION_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="px-1 py-2.5 text-[15px] font-medium text-foreground/80 transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="mt-1 border-t px-1 pb-3 pt-3.5 text-[15px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
          <Link
            href={getStartedHref}
            onClick={() => setOpen(false)}
            className="mt-1 inline-flex h-11 items-center justify-center gap-1.5 rounded-[10px] bg-brand text-[15px] font-semibold text-brand-foreground transition-[background-color,transform] hover:bg-brand-hover active:translate-y-px"
          >
            {primaryLabel}
            <ArrowRight className="size-[16px]" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </nav>
  )
}
