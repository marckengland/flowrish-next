'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Zap, Plus, Trash2, GripVertical } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Assignment rule configuration component.
 *
 * Allows managers/admins to configure automatic lead assignment rules:
 * - TERRITORY: assign by company/region match
 * - DEAL_SIZE: assign by deal value range
 * - ROUND_ROBIN: distribute evenly among users
 *
 * Rules are evaluated in priority order (lowest number first).
 *
 * Validates: Requirements 16.4, 16.5, 16.6
 */

interface AssignmentRule {
  id: string
  type: 'TERRITORY' | 'DEAL_SIZE' | 'ROUND_ROBIN'
  priority: number
  config: Record<string, unknown>
  isActive: boolean
  createdAt: string
}

type RuleType = 'TERRITORY' | 'DEAL_SIZE' | 'ROUND_ROBIN'

interface CreateRuleData {
  type: RuleType
  priority: number
  config: Record<string, unknown>
}

const RULE_TYPE_LABELS: Record<RuleType, string> = {
  TERRITORY: 'Territory',
  DEAL_SIZE: 'Deal Size',
  ROUND_ROBIN: 'Round Robin',
}

const RULE_TYPE_DESCRIPTIONS: Record<RuleType, string> = {
  TERRITORY: 'Assign leads based on company name or region match',
  DEAL_SIZE: 'Assign leads based on deal value range',
  ROUND_ROBIN: 'Distribute leads evenly among selected users',
}

export function AssignmentRules(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newRule, setNewRule] = useState<CreateRuleData>({
    type: 'TERRITORY',
    priority: 1,
    config: {},
  })

  const { data: rules, isLoading } = useQuery<AssignmentRule[]>({
    queryKey: ['assignment-rules'],
    queryFn: async () => {
      const res = await fetch('/api/admin/assignment-rules')
      if (!res.ok) throw new Error('Failed to fetch assignment rules')
      return res.json()
    },
  })

  const createMutation = useMutation({
    mutationFn: async (data: CreateRuleData) => {
      const res = await fetch('/api/admin/assignment-rules', {
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
      setNewRule({ type: 'TERRITORY', priority: 1, config: {} })
      queryClient.invalidateQueries({ queryKey: ['assignment-rules'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      const res = await fetch(`/api/admin/assignment-rules/${ruleId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete rule')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assignment-rules'] })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ ruleId, isActive }: { ruleId: string; isActive: boolean }) => {
      const res = await fetch(`/api/admin/assignment-rules/${ruleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      if (!res.ok) throw new Error('Failed to update rule')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assignment-rules'] })
    },
  })

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createMutation.mutate(newRule)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="size-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Assignment Rules</h2>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          <Plus className="size-4" aria-hidden="true" />
          <span>Add Rule</span>
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Rules are evaluated in priority order (lowest number first). The first matching rule assigns the lead.
      </p>

      {/* Create form */}
      {showCreateForm && (
        <form
          onSubmit={handleCreateSubmit}
          className="flex flex-col gap-3 rounded-md border bg-card p-4"
        >
          <h3 className="text-sm font-semibold">Add assignment rule</h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="rule-type" className="text-xs font-medium text-muted-foreground">
                Rule Type
              </label>
              <select
                id="rule-type"
                value={newRule.type}
                onChange={(e) => setNewRule((prev) => ({ ...prev, type: e.target.value as RuleType }))}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                {(Object.keys(RULE_TYPE_LABELS) as RuleType[]).map((type) => (
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
              <label htmlFor="rule-priority" className="text-xs font-medium text-muted-foreground">
                Priority
              </label>
              <input
                id="rule-priority"
                type="number"
                min={1}
                value={newRule.priority}
                onChange={(e) =>
                  setNewRule((prev) => ({ ...prev, priority: parseInt(e.target.value, 10) || 1 }))
                }
                className="h-8 rounded-md border bg-background px-2 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Lower number = higher priority
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
          <p className="text-sm text-muted-foreground">Loading rules...</p>
        </div>
      ) : !rules || rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border bg-card py-12">
          <Zap className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">No assignment rules</p>
          <p className="text-xs text-muted-foreground">
            Add rules to automatically assign new leads to team members.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rules
            .sort((a, b) => a.priority - b.priority)
            .map((rule) => (
              <div
                key={rule.id}
                className={`flex items-center gap-3 rounded-md border p-3 ${
                  rule.isActive ? 'bg-card' : 'bg-muted/30 opacity-60'
                }`}
              >
                <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      #{rule.priority}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {RULE_TYPE_LABELS[rule.type]}
                    </span>
                    {!rule.isActive && (
                      <span className="text-xs text-muted-foreground">(disabled)</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
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
