'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Layers, Plus, ChevronRight, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Team hierarchy CRUD component.
 *
 * Displays the organization's team tree structure and allows:
 * - Creating new teams (with optional parent team for nesting)
 * - Viewing team members
 * - Nested hierarchy visualization
 *
 * Validates: Requirements 2.5, 2.8
 */

interface Team {
  id: string
  name: string
  parentTeamId: string | null
  childTeams: Team[]
  memberCount?: number
}

interface CreateTeamData {
  name: string
  parentTeamId: string | null
}

export function TeamManagement(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newTeam, setNewTeam] = useState<CreateTeamData>({
    name: '',
    parentTeamId: null,
  })

  const { data: teams, isLoading } = useQuery<Team[]>({
    queryKey: ['org-teams-hierarchy'],
    queryFn: async () => {
      const res = await fetch('/api/admin/teams/hierarchy')
      if (!res.ok) throw new Error('Failed to fetch teams')
      return (await res.json()).data
    },
  })

  const createMutation = useMutation({
    mutationFn: async (data: CreateTeamData) => {
      const res = await fetch('/api/admin/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message ?? 'Failed to create team')
      }
      return res.json()
    },
    onSuccess: () => {
      setShowCreateForm(false)
      setNewTeam({ name: '', parentTeamId: null })
      queryClient.invalidateQueries({ queryKey: ['org-teams-hierarchy'] })
    },
  })

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTeam.name.trim()) return
    createMutation.mutate(newTeam)
  }

  // Flatten teams for the parent selector
  const flatTeams = flattenTeams(teams ?? [])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Teams</h2>
        <Button
          variant="default"
          size="sm"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          <Plus className="size-4" aria-hidden="true" />
          <span>Create team</span>
        </Button>
      </div>

      {/* Create team form */}
      {showCreateForm && (
        <form
          onSubmit={handleCreateSubmit}
          className="flex flex-col gap-3 rounded-md border bg-card p-4"
        >
          <h3 className="text-sm font-semibold">Create a new team</h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="team-name" className="text-xs font-medium text-muted-foreground">
                Team Name
              </label>
              <input
                id="team-name"
                type="text"
                required
                placeholder="e.g. Sales West"
                value={newTeam.name}
                onChange={(e) => setNewTeam((prev) => ({ ...prev, name: e.target.value }))}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="team-parent" className="text-xs font-medium text-muted-foreground">
                Parent Team (optional)
              </label>
              <select
                id="team-parent"
                value={newTeam.parentTeamId ?? ''}
                onChange={(e) =>
                  setNewTeam((prev) => ({
                    ...prev,
                    parentTeamId: e.target.value || null,
                  }))
                }
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">None (top-level)</option>
                {flatTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {'  '.repeat(team.depth)}{team.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Team'}
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

      {/* Team tree */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">Loading teams...</p>
        </div>
      ) : !teams || teams.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card py-12">
          <Layers className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">No teams yet</p>
          <p className="text-xs text-muted-foreground">
            Create your first team to organize members into groups.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-[18px]">
          <ul role="tree" aria-label="Team hierarchy" className="flex flex-col gap-1">
            {teams.map((team) => (
              <TeamNode key={team.id} team={team} depth={0} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function TeamNode({ team, depth }: { team: Team; depth: number }): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = team.childTeams && team.childTeams.length > 0

  return (
    <li
      role="treeitem"
      aria-selected={false}
      aria-expanded={hasChildren ? expanded : undefined}
    >
      <div
        className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 transition-colors hover:bg-muted/60 ${
          depth === 0 ? 'bg-muted/40' : ''
        }`}
        style={{ paddingLeft: `${depth * 20 + 12}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              className={`size-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="size-5" />
        )}
        <Layers
          className={`size-4 ${depth === 0 ? 'text-brand-emphasis' : 'text-muted-foreground'}`}
          aria-hidden="true"
        />
        <span
          className={`${depth === 0 ? 'text-sm font-semibold' : 'text-[13.5px] font-medium'} text-foreground`}
        >
          {team.name}
        </span>
        {team.memberCount !== undefined && (
          <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
            <Users className="size-3" aria-hidden="true" />
            {team.memberCount} member{team.memberCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {hasChildren && expanded && (
        <ul role="group" className="flex flex-col gap-0.5">
          {team.childTeams.map((child) => (
            <TeamNode key={child.id} team={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * Flattens a nested team tree into a flat list with depth info for select options.
 */
function flattenTeams(
  teams: Team[],
  depth = 0,
): Array<{ id: string; name: string; depth: number }> {
  const result: Array<{ id: string; name: string; depth: number }> = []
  for (const team of teams) {
    result.push({ id: team.id, name: team.name, depth })
    if (team.childTeams && team.childTeams.length > 0) {
      result.push(...flattenTeams(team.childTeams, depth + 1))
    }
  }
  return result
}
