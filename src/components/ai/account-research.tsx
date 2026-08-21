'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  BookmarkPlus,
  Building2,
  Cpu,
  ExternalLink,
  Lightbulb,
  Send,
  Sparkles,
  Target,
  TriangleAlert,
} from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Shape returned by `POST /api/ai/research` on success.
 */
interface AccountResearch {
  executiveSummary: string
  websiteSummary: string
  strategicGoals: string
  salesAngles: string[]
  challenges: string[]
  aiReadiness: string
  solutionFit: string
  outreachAngle: string
  sources: string[]
}

interface ResearchResponse {
  data?: AccountResearch
  error?: { code?: string; message?: string }
}

interface SavedInsight {
  id: string
  summary: string | null
  kind: string
  createdAt: string
}

export interface AccountResearchProps {
  /** The company to research. */
  companyId: string
  /** Optional company display name used in the heading. */
  companyName?: string
}

/**
 * AI research results display for a company account.
 *
 * Triggers `POST /api/ai/research`, which the route handler forwards to the
 * `researchAccount` service. The service sends company details to the AI
 * provider and returns a structured intelligence payload — executive summary,
 * strategic goals, sales angles, and challenges (Requirement 8.2). The
 * admin-configured system prompt is included only when active (Requirement
 * 8.4), and all failure modes surface the generic server message without
 * exposing provider internals (Requirement 8.5).
 *
 * The panel is informational: it doesn&rsquo;t mutate CRM data, just renders
 * the structured result. A "Refresh" action re-queries the AI, and the
 * rendered lists gracefully handle empty results as empty states.
 *
 * Validates: Requirements 8.2, 8.4, 8.5
 */
export function AccountResearch({
  companyId,
  companyName,
}: AccountResearchProps): React.JSX.Element {
  const [research, setResearch] = useState<AccountResearch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const [savedInsights, setSavedInsights] = useState<SavedInsight[]>([])
  const [saving, startSaving] = useTransition()
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  // Load any previously-saved insights for this company.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/insights?entityType=COMPANY&entityId=${encodeURIComponent(companyId)}`,
          { credentials: 'same-origin' },
        )
        if (!res.ok) return
        const body = (await res.json()) as { data?: SavedInsight[] }
        if (!cancelled && Array.isArray(body.data)) setSavedInsights(body.data)
      } catch {
        // non-fatal
      }
    })()
    return () => {
      cancelled = true
    }
  }, [companyId])

  function saveResearch(): void {
    if (!research || saving) return
    setSaveMsg(null)
    startSaving(async () => {
      try {
        const res = await fetch('/api/insights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            entityType: 'COMPANY',
            entityId: companyId,
            kind: 'research',
            summary: research.executiveSummary?.slice(0, 2000) ?? null,
            data: research,
            sources: research.sources,
            source: 'ai',
          }),
        })
        const body = (await res.json().catch(() => ({}))) as {
          data?: SavedInsight
          error?: { message?: string }
        }
        if (!res.ok || !body.data) {
          setSaveMsg(body.error?.message ?? 'Could not save.')
          return
        }
        setSavedInsights((prev) => [body.data as SavedInsight, ...prev])
        setSaveMsg('Saved to this company.')
      } catch {
        setSaveMsg('Could not save.')
      }
    })
  }

  function fetchResearch(): void {
    if (pending) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/ai/research', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          credentials: 'same-origin',
          body: JSON.stringify({ companyId }),
        })
        const json = (await res.json().catch(() => ({}))) as ResearchResponse
        if (!res.ok) {
          setError(
            json.error?.message ?? 'AI service temporarily unavailable',
          )
          return
        }
        if (!json.data) {
          setError('AI service temporarily unavailable')
          return
        }
        setResearch({
          executiveSummary: json.data.executiveSummary ?? '',
          websiteSummary: json.data.websiteSummary ?? '',
          strategicGoals: json.data.strategicGoals ?? '',
          salesAngles: Array.isArray(json.data.salesAngles)
            ? json.data.salesAngles
            : [],
          challenges: Array.isArray(json.data.challenges)
            ? json.data.challenges
            : [],
          aiReadiness: json.data.aiReadiness ?? '',
          solutionFit: json.data.solutionFit ?? '',
          outreachAngle: json.data.outreachAngle ?? '',
          sources: Array.isArray(json.data.sources) ? json.data.sources : [],
        })
      } catch {
        setError('AI service temporarily unavailable')
      }
    })
  }

  const hasResult = research !== null
  const actionLabel = pending
    ? 'Researching…'
    : hasResult
      ? 'Refresh'
      : 'Research account'

  return (
    <section
      aria-labelledby="account-research-heading"
      className="space-y-4 rounded-lg border bg-card p-4 shadow-sm"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="account-research-heading"
            className="flex items-center gap-2 text-sm font-semibold text-foreground"
          >
            <Building2 className="size-4 text-primary" aria-hidden="true" />
            Account Research
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {companyName
              ? `AI-generated sales intelligence for ${companyName}.`
              : 'AI-generated sales intelligence for this company.'}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={fetchResearch}
          disabled={pending}
          aria-label={hasResult ? 'Refresh account research' : 'Run account research'}
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          {actionLabel}
        </Button>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-danger-foreground">
          {error}
        </p>
      ) : null}

      {hasResult && research ? (
        <div className="space-y-4" data-testid="account-research-result">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {saveMsg ?? 'Save this to keep it on the company record.'}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={saveResearch}
              disabled={saving}
            >
              <BookmarkPlus className="size-3.5" aria-hidden="true" />
              {saving ? 'Saving…' : 'Save to record'}
            </Button>
          </div>
          <ResearchField
            label="Executive summary"
            value={research.executiveSummary}
          />
          {research.websiteSummary ? (
            <ResearchField
              label="What they do (from their website)"
              value={research.websiteSummary}
            />
          ) : null}
          <ResearchField
            label="Strategic goals"
            value={research.strategicGoals}
          />

          <ResearchList
            label="Sales angles"
            icon={<Target className="size-3.5 text-primary" aria-hidden="true" />}
            items={research.salesAngles}
            emptyMessage="No sales angles returned."
          />

          <ResearchList
            label="Challenges"
            icon={
              <TriangleAlert
                className="size-3.5 text-warning-foreground"
                aria-hidden="true"
              />
            }
            items={research.challenges}
            emptyMessage="No challenges identified."
          />

          {research.aiReadiness ? (
            <div>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Cpu className="size-3.5" aria-hidden="true" />
                AI / tech readiness
              </h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {research.aiReadiness}
              </p>
            </div>
          ) : null}

          {research.solutionFit ? (
            <div className="rounded-lg border border-brand/30 bg-brand-subtle/40 p-3">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-emphasis">
                <Lightbulb className="size-3.5" aria-hidden="true" />
                Solution fit (business evaluation)
              </h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {research.solutionFit}
              </p>
            </div>
          ) : null}

          {research.outreachAngle ? (
            <div>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Send className="size-3.5" aria-hidden="true" />
                Suggested outreach angle
              </h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {research.outreachAngle}
              </p>
            </div>
          ) : null}

          {research.sources.length > 0 ? (
            <div>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <ExternalLink className="size-3.5" aria-hidden="true" />
                Sources
              </h3>
              <ul className="mt-1 space-y-1">
                {research.sources.map((source, index) => (
                  <li
                    key={`source-${index}`}
                    className="text-xs text-muted-foreground"
                  >
                    {/^https?:\/\//.test(source) ? (
                      <a
                        href={source}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-emphasis underline hover:no-underline"
                      >
                        {source}
                      </a>
                    ) : (
                      source
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : !pending ? (
        <p className="rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
          No research yet. Click <strong>Research account</strong> to ask the
          AI for a briefing on this company.
        </p>
      ) : null}

      {savedInsights.length > 0 ? (
        <div className="border-t pt-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <BookmarkPlus className="size-3.5" aria-hidden="true" />
            Saved insights ({savedInsights.length})
          </h3>
          <ul className="mt-2 space-y-2">
            {savedInsights.map((insight) => (
              <li
                key={insight.id}
                className="rounded-md border bg-muted/20 px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span className="font-medium uppercase tracking-wide">
                    {insight.kind}
                  </span>
                  <time dateTime={insight.createdAt}>
                    {new Date(insight.createdAt).toLocaleDateString()}
                  </time>
                </div>
                {insight.summary ? (
                  <p className="mt-1 line-clamp-3 text-foreground">
                    {insight.summary}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function ResearchField({
  label,
  value,
}: {
  label: string
  value: string
}): React.JSX.Element {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      {value ? (
        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
          {value}
        </p>
      ) : (
        <p className="mt-1 text-sm italic text-muted-foreground">Not available.</p>
      )}
    </div>
  )
}

function ResearchList({
  label,
  icon,
  items,
  emptyMessage,
}: {
  label: string
  icon: React.ReactNode
  items: readonly string[]
  emptyMessage: string
}): React.JSX.Element {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      {items.length === 0 ? (
        <p className="mt-1 text-sm italic text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <ul className="mt-1 space-y-1.5">
          {items.map((item, index) => (
            <li
              key={`${label}-${index}`}
              className="flex items-start gap-2 text-sm text-foreground"
            >
              <span className="mt-0.5 shrink-0">{icon}</span>
              <span className="whitespace-pre-wrap">{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
