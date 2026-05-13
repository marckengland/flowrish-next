'use client'

import { useState } from 'react'
import { Settings, Zap, Target, Brain, Timer } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ScoringRules } from '@/components/scoring/scoring-rules'
import { ScoreDecayConfig } from '@/components/scoring/score-decay-config'
import { AssignmentRules } from '@/components/admin/assignment-rules'
import { AiPromptConfig } from '@/components/ai/ai-prompt-config'

/**
 * Organization settings page.
 *
 * Provides configuration panels for:
 * - Scoring rules (lead scoring configuration)
 * - Score decay (inactivity-based score reduction)
 * - Assignment rules (automatic lead assignment)
 * - AI prompt configuration (system prompts for AI features)
 *
 * Accessible to users with `settings:manage` permission (OWNER, ADMIN, MANAGER).
 *
 * Validates: Requirements 2.11, 16.1, 16.4, 33.6
 */

type SettingsTab = 'scoring' | 'decay' | 'assignment' | 'ai'

const TABS: Array<{ id: SettingsTab; label: string; icon: typeof Settings }> = [
  { id: 'scoring', label: 'Scoring Rules', icon: Target },
  { id: 'decay', label: 'Score Decay', icon: Timer },
  { id: 'assignment', label: 'Assignment Rules', icon: Zap },
  { id: 'ai', label: 'AI Prompts', icon: Brain },
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
          {activeTab === 'scoring' && <ScoringRules />}
          {activeTab === 'decay' && <ScoreDecayConfig />}
          {activeTab === 'assignment' && <AssignmentRules />}
          {activeTab === 'ai' && <AiPromptConfig />}
        </section>
      </div>
    </div>
  )
}
