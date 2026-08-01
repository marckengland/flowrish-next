'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Target, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Scoring rule CRUD component.
 *
 * Allows managers/admins to configure lead scoring rules:
 * - activity_count: points per activity logged
 * - deal_value: points per $1K deal value
 * - stage_progression: points per stage transition
 * - email_engagement: points per email interaction
 *
 * Each rule has a type, points value, optional config (thresholds), and active toggle.
 *
 * Validates: Requirements 16.1, 16.2, 16.3
 */

interface ScoringRule {
  id: string
  type: string
  points: number
  config: Record<string, unknown>
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type ScoringRuleType = 'activity_count' | 'deal_value' | 'stage_progression' | 'email_engagement'

interface CreateRuleData {
  type: ScoringRuleType
  points: number
  config: Record<string, unknown>
}

const RULE_TYPE_LABELS: Record<ScoringRuleType, string> = {
  activity_count: 'Activity Count',
  deal_value: 'Deal Value',
  stage_progression: 'Stage Progression',
  email_engagement: 'Email Engagement',
}

const RULE_TYPE_DESCRIPTIONS: Record<ScoringRuleType, string> = {
  activity_count: 'Award points based on number of activities logged on a lead',
  deal_value: 'Award points based on the deal value (per $1K)',
  stage_progression: 'Award points for each stage transition',
  email_engagement: 'Award points for email interactions',
}

export function ScoringRules(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newRule, setNewRule] = useState<CreateRuleData>({
    type: 'activity_count',
    points: 5,
    config: {},
  })

  const { data: rules, isLoading } = useQuery<ScoringRule[]>({
    queryKey: ['scoring-rules'],
    queryFn: async () => {
      const res = await fetch('/api/admin/scoring-rules')
      if (!res.ok) throw new Error('Failed to fetch scoring rules')
      return (await res.json()).data
    },
  })

  const createMutation = useMutation({
    mutationFn: async (data: CreateRuleData) => {
      const res = await fetch('/api/admin/scoring-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message ?? 'Failed to create rule')
      }
      return res.json()
    },
    onSuccess: () => {
      setShowCreateForm(false)
      setNewRule({ type: 'activity_count', points: 5, config: {} })
      queryClient.invalidateQueries({ queryKey: ['scoring-rules'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      const res = await fetch(`/api/admin/scoring-rules/${ruleId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete rule')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scoring-rules'] })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ ruleId, isActive }: { ruleId: string; isActive: boolean }) => {
      const res = await fetch(`/api/admin/scoring-rules/${ruleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      if (!res.ok) throw new Error('Failed to update rule')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scoring-rules'] })
    },
  })

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createMutation.mutate(newRule)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Lead scoring rules
        </h2>
        <Button
          variant="default"
          size="sm"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          <Plus className="size-4" aria-hidden="true" />
          <span>Add rule</span>
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Configure how lead scores are calculated. Scores are clamped to 0–100.
      </p>

      {/* Create form */}
      {showCreateForm && (
        <form
          onSubmit={handleCreateSubmit}
          className="flex flex-col gap-3 rounded-md border bg-card p-4"
        >
          <h3 className="text-sm font-semibold">Add scoring rule</h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="scoring-type" className="text-xs font-medium text-muted-foreground">
                Rule Type
              </label>
              <select
                id="scoring-type"
                value={newRule.type}
                onChange={(e) =>
                  setNewRule((prev) => ({ ...prev, type: e.target.value as ScoringRuleType }))
                }
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                {(Object.keys(RULE_TYPE_LABELS) as ScoringRuleType[]).map((type) => (
                  <option key={type} value={type}>
                    {RULE_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {RULE_TYPE_DESCRIPTIONS[newRule.type]}
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="scoring-points" className="text-xs font-medium text-muted-foreground">
                Points
              </label>
              <input
                id="scoring-points"
                type="number"
                min={1}
                max={100}
                value={newRule.points}
                onChange={(e) =>
                  setNewRule((prev) => ({ ...prev, points: parseInt(e.target.value, 10) || 1 }))
                }
                className="h-8 rounded-md border bg-background px-2 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Points awarded per unit of the rule type
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Rule'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowCreateForm(false)}
            >
              Cancel
            </Button>
          </div>

          {createMutation.isError && (
            <p className="text-xs text-destructive" role="alert">
              {createMutation.error.message}
            </p>
          )}
        </form>
      )}

      {/* Rules list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">Loading scoring rules...</p>
        </div>
      ) : !rules || rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card py-12">
          <Target className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">No scoring rules</p>
          <p className="text-xs text-muted-foreground">
            Add rules to automatically calculate lead scores based on activity and engagement.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`flex items-center justify-between gap-3 rounded-[11px] border bg-card px-4 py-3.5 ${
                rule.isActive ? '' : 'opacity-60'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-[13.5px] text-foreground">
                  {RULE_TYPE_LABELS[rule.type as ScoringRuleType] ?? rule.type}
                </span>
                {!rule.isActive && (
                  <span className="text-xs text-muted-foreground">(disabled)</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="tnum font-mono text-[13px] font-semibold text-brand-emphasis">
                  +{rule.points}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() =>
                    toggleMutation.mutate({ ruleId: rule.id, isActive: !rule.isActive })
                  }
                  aria-label={rule.isActive ? 'Disable rule' : 'Enable rule'}
                >
                  <span className="text-xs">{rule.isActive ? 'On' : 'Off'}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => deleteMutation.mutate(rule.id)}
                  aria-label="Delete rule"
                >
                  <Trash2 className="size-3.5 text-destructive" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
