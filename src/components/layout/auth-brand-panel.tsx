import Image from 'next/image'

/**
 * Left-hand dark brand panel shared by the sign-in and onboarding screens.
 *
 * Design: near-black surface with a blurred emerald glow, the lily logo +
 * wordmark, a headline, subhead, two stat cards, and a compliance line.
 */
export function AuthBrandPanel(): React.JSX.Element {
  return (
    <div className="relative hidden flex-col justify-between overflow-hidden bg-[oklch(0.16_0_0)] px-14 py-14 text-white lg:flex">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-28 -top-40 size-[520px] rounded-full bg-brand/16 blur-[80px]"
      />

      <div className="relative flex items-center gap-3">
        <Image
          src="/flower-emerald.png"
          alt=""
          aria-hidden="true"
          width={24}
          height={24}
          className="size-6 object-contain"
        />
        <span className="text-[19px] font-semibold tracking-[-0.01em]">
          Flowrish
        </span>
      </div>

      <div className="relative">
        <div className="mb-5 font-mono text-[12px] tracking-[0.1em] text-brand-emphasis/90 text-[oklch(0.78_0.15_156)]">
          REVENUE PLATFORM
        </div>
        <h1 className="mb-5 max-w-[440px] text-[42px] font-bold leading-[1.05] tracking-[-0.03em] text-balance">
          The CRM that does the busywork.
        </h1>
        <p className="mb-9 max-w-[400px] text-[16px] leading-[1.6] text-white/70">
          Logging, follow-ups and forecasting on autopilot — so your reps spend
          their day closing, not updating fields.
        </p>
        <div className="flex gap-3.5">
          <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.05] p-4">
            <div className="mb-2 font-mono text-[10px] tracking-[0.06em] text-white/50">
              HRS SAVED / REP / WK
            </div>
            <div className="tnum text-[28px] font-semibold text-[oklch(0.82_0.14_156)]">
              6.2
            </div>
          </div>
          <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.05] p-4">
            <div className="mb-2 font-mono text-[10px] tracking-[0.06em] text-white/50">
              FORECAST ACCURACY
            </div>
            <div className="tnum text-[28px] font-semibold text-white">94%</div>
          </div>
        </div>
      </div>

      <div className="relative font-mono text-[12px] text-white/40">
        SOC 2 Type II · GDPR · 99.9% uptime
      </div>
    </div>
  )
}
