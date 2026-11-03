import Image from 'next/image'
import { siteConfig } from '@/lib/site'
import {
  LayoutDashboard,
  GitBranchPlus,
  Target,
  Users,
  Zap,
  TrendingUp,
} from 'lucide-react'

/**
 * Static browser-chrome dashboard mockup shown in the landing hero.
 * Purely decorative — mirrors the design prototype's product screenshot.
 */
export function DashboardMockup(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-2xl border bg-card shadow-[0_44px_90px_-30px_rgba(0,0,0,0.34)]"
    >
      {/* window chrome */}
      <div className="flex h-9 items-center gap-1.5 border-b bg-background px-3.5">
        <span className="size-[11px] rounded-full bg-foreground/15" />
        <span className="size-[11px] rounded-full bg-foreground/15" />
        <span className="size-[11px] rounded-full bg-foreground/15" />
        <span className="ml-3 font-mono text-[11px] text-muted-foreground">
          {new URL(siteConfig.url).host}
        </span>
      </div>

      <div className="grid h-[432px] grid-cols-[184px_1fr]">
        {/* mini sidebar */}
        <div className="flex flex-col gap-[3px] border-r bg-background p-2.5">
          <div className="flex items-center gap-2 px-2 pb-3 pt-1.5">
            <Image
              src="/flower-emerald.png"
              alt=""
              width={17}
              height={17}
              className="size-[17px] object-contain"
            />
            <span className="text-[14px] font-semibold">Northwind Co.</span>
          </div>
          <MockNav icon={LayoutDashboard} label="Dashboard" active />
          <MockNav icon={GitBranchPlus} label="Pipeline" />
          <MockNav icon={Target} label="Leads" />
          <MockNav icon={Users} label="Contacts" />
          <MockNav icon={Zap} label="Cadences" />
          <MockNav icon={TrendingUp} label="Forecast" />
        </div>

        {/* content */}
        <div className="overflow-hidden p-5">
          <div className="text-[16px] font-semibold">Dashboard</div>
          <div className="mb-3.5 text-[12px] text-muted-foreground">
            Signals, forecasts and pipeline metrics.
          </div>
          <div className="mb-3.5 flex gap-[18px] border-b text-[12px]">
            <span className="border-b-2 border-foreground pb-2 font-semibold">
              Today&apos;s Rhythm
            </span>
            <span className="pb-2 text-muted-foreground">Deal Health</span>
            <span className="pb-2 text-muted-foreground">Forecast</span>
          </div>
          <div className="mb-3.5 grid grid-cols-3 gap-2.5">
            <MockMetric label="Open actions" value="27" />
            <MockMetric label="Due today" value="8" />
            <MockMetric label="Overdue" value="3" tone="danger" />
          </div>
          <div className="overflow-hidden rounded-[10px] border">
            <div className="flex items-center justify-between border-b px-3.5 py-2.5">
              <span className="text-[12px] font-semibold">Top priorities</span>
              <span className="text-[10px] text-muted-foreground">
                View all
              </span>
            </div>
            <MockRow
              score="92"
              tone="danger"
              title="Call about renewal, 3 days left"
              meta="Acme Corp · Overdue Jul 24"
            />
            <MockRow
              score="64"
              tone="warning"
              title="Send proposal follow-up"
              meta="Globex Inc · Due Jul 27"
            />
            <MockRow
              score="31"
              tone="neutral"
              title="Log discovery-call notes"
              meta="Initech · Due Jul 29"
              last
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function MockNav({
  icon: Icon,
  label,
  active,
}: {
  icon: typeof LayoutDashboard
  label: string
  active?: boolean
}): React.JSX.Element {
  return (
    <div
      className={
        active
          ? 'flex items-center gap-2.5 rounded-lg bg-brand/12 px-2.5 py-2 text-[13px] font-medium text-brand-emphasis'
          : 'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-muted-foreground'
      }
    >
      <Icon className="size-4" />
      {label}
    </div>
  )
}

function MockMetric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'danger'
}): React.JSX.Element {
  return (
    <div className="rounded-[9px] border p-3">
      <div className="eyebrow mb-2 !text-[9px]">{label}</div>
      <div
        className={
          tone === 'danger'
            ? 'tnum text-2xl font-semibold text-danger-foreground'
            : 'tnum text-2xl font-semibold'
        }
      >
        {value}
      </div>
    </div>
  )
}

function MockRow({
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
    <div
      className={`flex items-center gap-3 px-3.5 py-2.5 ${last ? '' : 'border-b border-row-divider'}`}
    >
      <span
        className={`flex size-[30px] items-center justify-center rounded-full text-[11px] font-bold tnum ${toneClass}`}
      >
        {score}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium">{title}</div>
        <div className="text-[10.5px] text-muted-foreground">{meta}</div>
      </div>
    </div>
  )
}
