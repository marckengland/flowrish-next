'use client'

import { useState } from 'react'
import { Zap, Target, Brain, Timer, Mail } from 'lucide-react'

import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScoringRules } from '@/components/scoring/scoring-rules'
import { ScoreDecayConfig } from '@/components/scoring/score-decay-config'
import { RankedLeadList } from '@/components/scoring/ranked-lead-list'
import { AssignmentRules } from '@/components/admin/assignment-rules'
import { AiPromptConfig } from '@/components/ai/ai-prompt-config'
import { GmailConnect } from '@/components/email/gmail-connect'
import { EmailSyncStatus } from '@/components/email/email-sync-status'

/**
 * Organization settings page.
 *
 * Provides configuration panels for:
 * - Scoring rules (lead scoring configuration)
 * - Score decay (inactivity-based score reduction)
 * - Assignment rules (automatic lead assignment)
 * - AI prompt configuration (system prompts for AI features)
 *
 * Accessible to users with `admin:settings` permission (OWNER, ADMIN, MANAGER).
 *
 * Validates: Requirements 2.11, 16.1, 16.4, 33.6
 */

type SettingsTab = 'scoring' | 'decay' | 'assignment' | 'ai' | 'email'

const TABS: Array<{ id: SettingsTab; label: string; icon: typeof Target }> = [
  { id: 'scoring', label: 'Scoring rules', icon: Target },
  { id: 'decay', label: 'Score decay', icon: Timer },
  { id: 'assignment', label: 'Assignment rules', icon: Zap },
  { id: 'ai', label: 'AI prompts', icon: Brain },
  { id: 'email', label: 'Email (Gmail)', icon: Mail },
]

export default function SettingsPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<SettingsTab>('scoring')

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5">
      <PageHeader
        title="Settings"
        description="Configure scoring, assignment rules, AI prompts and email for your organization."
      />

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[212px_1fr] lg:items-start lg:gap-6">
        {/* Left rail navigation */}
        <nav
          aria-label="Settings sections"
          className="flex flex-row gap-1 overflow-x-auto lg:flex-col lg:gap-[3px] lg:overflow-x-visible"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[13px] font-medium transition-colors',
                  isActive
                    ? 'bg-brand-subtle text-brand-emphasis'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-[15px] shrink-0" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Content panel */}
        <section className="min-w-0" aria-label={`${activeTab} settings`}>
          {activeTab === 'scoring' && (
            <div className="flex flex-col gap-[18px]">
              <ScoringRules />
              <Card>
                <CardHeader>
                  <CardTitle>Top-ranked leads</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <RankedLeadList />
                </CardContent>
              </Card>
            </div>
          )}
          {activeTab === 'decay' && <ScoreDecayConfig />}
          {activeTab === 'assignment' && <AssignmentRules />}
          {activeTab === 'ai' && <AiPromptConfig />}
          {activeTab === 'email' && (
            <div className="flex max-w-[560px] flex-col gap-[14px]">
              <GmailConnect
                googleClientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? ''}
                redirectUri={typeof window !== 'undefined' ? `${window.location.origin}/api/email/callback` : '/api/email/callback'}
              />
              <Card>
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-[13.5px] font-semibold text-foreground">
                      Inbox sync
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Pulls the latest replies from your connected Gmail account
                      into the activity timeline.
                    </p>
                  </div>
                  <EmailSyncStatus className="shrink-0" />
                </CardContent>
              </Card>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
