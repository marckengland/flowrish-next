'use client'

import { useState, useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { createOrg, joinOrg } from '@/server/actions/onboarding'

type Tab = 'create' | 'join'

/**
 * Client-side onboarding form with two options:
 * 1. Create a new Organization (name + slug)
 * 2. Join an existing Organization via invite code
 *
 * Uses React 19 useActionState for server action integration.
 */
export function OnboardingForm() {
  const [activeTab, setActiveTab] = useState<Tab>('create')
  const [createState, createAction, createPending] = useActionState(
    async (_prev: { error: string } | null, formData: FormData) => {
      const result = await createOrg(formData)
      return result ?? null
    },
    null,
  )
  const [joinState, joinAction, joinPending] = useActionState(
    async (_prev: { error: string } | null, formData: FormData) => {
      const result = await joinOrg(formData)
      return result ?? null
    },
    null,
  )

  return (
    <div className="space-y-4">
      {/* Tab Switcher */}
      <div className="flex rounded-lg border border-border bg-muted p-1">
        <button
          type="button"
          onClick={() => setActiveTab('create')}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === 'create'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Create Organization
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('join')}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === 'join'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Join with Invite
        </button>
      </div>

      {/* Create Organization Form */}
      {activeTab === 'create' && (
        <form action={createAction} className="space-y-4">
          <div>
            <label
              htmlFor="org-name"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              Organization Name
            </label>
            <input
              id="org-name"
              name="name"
              type="text"
              required
              placeholder="Acme Corp"
              autoComplete="organization"
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div>
            <label
              htmlFor="org-slug"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              URL Slug
            </label>
            <input
              id="org-slug"
              name="slug"
              type="text"
              required
              placeholder="acme-corp"
              pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Lowercase letters, numbers, and hyphens only.
            </p>
          </div>

          {createState?.error && (
            <p className="text-sm text-destructive">{createState.error}</p>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={createPending}
          >
            {createPending ? 'Creating...' : 'Create Organization'}
          </Button>
        </form>
      )}

      {/* Join Organization Form */}
      {activeTab === 'join' && (
        <form action={joinAction} className="space-y-4">
          <div>
            <label
              htmlFor="invite-code"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              Invite Code
            </label>
            <input
              id="invite-code"
              name="inviteCode"
              type="text"
              required
              placeholder="Enter your invite code"
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Ask your team admin for an invite code to join their organization.
            </p>
          </div>

          {joinState?.error && (
            <p className="text-sm text-destructive">{joinState.error}</p>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={joinPending}
          >
            {joinPending ? 'Joining...' : 'Join Organization'}
          </Button>
        </form>
      )}
    </div>
  )
}
