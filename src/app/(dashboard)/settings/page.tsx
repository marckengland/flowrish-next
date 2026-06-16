'use client'

import { useState } from 'react'
import { Settings, Zap, Target, Brain, Timer, Mail } from 'lucide-react'

import { Button } from '@/components/ui/button'
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

const TABS: Array<{ id: SettingsTab; label: string; icon: typeof Settings }> = [
  { id: 'scoring', label: 'Scoring Rules', icon: Target },
  { id: 'decay', label: 'Score Decay', icon: Timer },
  { id: 'assignment', label: 'Assignment Rules', icon: Zap },
  { id: 'ai', label: 'AI Prompts', icon: Brain },
  { id: 'email', label: 'Email (Gmail)', icon: Mail },
]

export default function SettingsPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<SettingsTab>('scoring')

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure scoring, assignment rules, and AI prompts for your
          organization.
        </p>
      </header>

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        {/* Tab navigation */}
        <nav
          aria-label="Settings sections"
          className="flex flex-row gap-1 overflow-x-auto lg:w-56 lg:flex-col lg:overflow-x-visible"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? 'secondary' : 'ghost'}
                size="sm"
                className="justify-start gap-2"
                onClick={() => setActiveTab(tab.id)}
                aria-current={activeTab === tab.id ? 'page' : undefined}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span>{tab.label}</span>
              </Button>
            )
          })}
        </nav>

        {/* Tab content */}
        <section className="min-w-0 flex-1" aria-label={`${activeTab} settings`}>
          {activeTab === 'scoring' && (
            <div className="flex flex-col gap-6">
              <ScoringRules />
              <RankedLeadList />
            </div>
          )}
          {activeTab === 'decay' && <ScoreDecayConfig />}
          {activeTab === 'assignment' && <AssignmentRules />}
          {activeTab === 'ai' && <AiPromptConfig />}
          {activeTab === 'email' && (
            <div className="flex flex-col gap-4">
              <GmailConnect
                googleClientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? ''}
                redirectUri={typeof window !== 'undefined' ? `${window.location.origin}/api/email/callback` : '/api/email/callback'}
              />
              <section
                aria-label="Email sync"
                className="flex flex-col gap-2 rounded-md border bg-card p-4"
              >
                <h3 className="text-sm font-semibold">Manual sync</h3>
                <p className="text-xs text-muted-foreground">
                  Pull the latest messages from your connected Gmail
                  account into the activity timeline.
                </p>
                <EmailSyncStatus className="mt-1" />
              </section>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
