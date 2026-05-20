'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Timer, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Score decay configuration component.
 *
 * Allows managers/admins to configure how lead scores decay over time
 * when leads become inactive. Each config specifies:
 * - inactivityDays: number of days without activity before decay starts
 * - pointReduction: points to subtract per decay cycle
 * - isActive: whether this decay rule is currently active
 *
 * The score decay job runs daily at midnight UTC and applies these rules.
 *
 * Validates: Requirements 14.3, 16.1
 */

interface DecayConfig {
  id: string
  inactivityDays: number
  pointReduction: number
  isActive: boolean
  updatedAt: string
}

interface CreateDecayData {
  inactivityDays: number
  pointReduction: number
}

export function ScoreDecayConfig(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newConfig, setNewConfig] = useState<CreateDecayData>({
    inactivityDays: 14,
    pointReduction: 5,
  })

  const { data: configs, isLoading } = useQuery<DecayConfig[]>({
    queryKey: ['score-decay-configs'],
    queryFn: async () => {
      const res = await fetch('/api/admin/score-decay')
      if (!res.ok) throw new Error('Failed to fetch decay configs')
      return (await res.json()).data
    },
  })

  const createMutation = useMutation({
    mutationFn: async (data: CreateDecayData) => {
      const res = await fetch('/api/admin/score-decay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message ?? 'Failed to create config')
      }
      return res.json()
    },
    onSuccess: () => {
      setShowCreateForm(false)
      setNewConfig({ inactivityDays: 14, pointReduction: 5 })
      queryClient.invalidateQueries({ queryKey: ['score-decay-configs'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (configId: string) => {
      const res = await fetch(`/api/admin/score-decay/${configId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete config')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['score-decay-configs'] })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ configId, isActive }: { configId: string; isActive: boolean }) => {
      const res = await fetch(`/api/admin/score-decay/${configId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      if (!res.ok) throw new Error('Failed to update config')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['score-decay-configs'] })
    },
  })

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createMutation.mutate(newConfig)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Timer className="size-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Score Decay</h2>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          <Plus className="size-4" aria-hidden="true" />
          <span>Add Config</span>
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Configure how lead scores decrease when leads become inactive. The decay job runs daily at midnight UTC.
      </p>

      {/* Create form */}
      {showCreateForm && (
        <form
          onSubmit={handleCreateSubmit}
          className="flex flex-col gap-3 rounded-md border bg-card p-4"
        >
          <h3 className="text-sm font-semibold">Add decay configuration</h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="decay-days" className="text-xs font-medium text-muted-foreground">
                Inactivity Days
              </label>
              <input
                id="decay-days"
                type="number"
                min={1}
                max={365}
                value={newConfig.inactivityDays}
                onChange={(e) =>
                  setNewConfig((prev) => ({
                    ...prev,
                    inactivityDays: parseInt(e.target.value, 10) || 14,
                  }))
                }
                className="h-8 rounded-md border bg-background px-2 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Days without activity before decay begins
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="decay-points" className="text-xs font-medium text-muted-foreground">
                Point Reduction
              </label>
              <input
                id="decay-points"
                type="number"
                min={1}
                max={50}
                value={newConfig.pointReduction}
                onChange={(e) =>
                  setNewConfig((prev) => ({
                    ...prev,
                    pointReduction: parseInt(e.target.value, 10) || 5,
                  }))
                }
                className="h-8 rounded-md border bg-background px-2 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Points subtracted per decay cycle
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Config'}
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

      {/* Configs list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">Loading decay configs...</p>
        </div>
      ) : !configs || configs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border bg-card py-12">
          <Timer className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">No decay configurations</p>
          <p className="text-xs text-muted-foreground">
            Add a decay config to automatically reduce scores for inactive leads.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {configs.map((config) => (
            <div
              key={config.id}
              className={`flex items-center gap-3 rounded-md border p-3 ${
                config.isActive ? 'bg-card' : 'bg-muted/30 opacity-60'
              }`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-3">
                  <span className="text-sm">
                    <span className="font-medium">{config.inactivityDays}</span>{' '}
                    <span className="text-muted-foreground">days inactive</span>
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-sm">
                    <span className="font-medium">-{config.pointReduction}</span>{' '}
                    <span className="text-muted-foreground">pts/cycle</span>
                  </span>
                  {!config.isActive && (
                    <span className="text-xs text-muted-foreground">(disabled)</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() =>
                    toggleMutation.mutate({ configId: config.id, isActive: !config.isActive })
                  }
                  aria-label={config.isActive ? 'Disable config' : 'Enable config'}
                >
                  <span className="text-xs">{config.isActive ? 'On' : 'Off'}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => deleteMutation.mutate(config.id)}
                  aria-label="Delete config"
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
