'use client'

import { useState, useActionState } from 'react'
import { siteConfig } from '@/lib/site'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
      {/* Segmented toggle */}
      <div className="mb-[22px] flex rounded-[11px] border border-border bg-muted p-1">
        <button
          type="button"
          onClick={() => setActiveTab('create')}
          className={`flex-1 rounded-[8px] px-3 py-2 text-[13px] font-medium transition-colors ${
            activeTab === 'create'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Create organization
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('join')}
          className={`flex-1 rounded-[8px] px-3 py-2 text-[13px] font-medium transition-colors ${
            activeTab === 'join'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Join with invite
        </button>
      </div>

      {/* Create Organization Form */}
      {activeTab === 'create' && (
        <form action={createAction} className="space-y-4">
          <div>
            <label
              htmlFor="org-name"
              className="mb-1.5 block text-[13px] font-medium text-foreground"
            >
              Organization name
            </label>
            <Input
              id="org-name"
              name="name"
              type="text"
              required
              placeholder="Northwind Co."
              autoComplete="organization"
            />
          </div>

          <div>
            <label
              htmlFor="org-slug"
              className="mb-1.5 block text-[13px] font-medium text-foreground"
            >
              URL slug
            </label>
            <div className="flex flex-col overflow-hidden rounded-[10px] sm:flex-row border border-input bg-card focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand/15">
              <span className="flex h-10 items-center border-b border-border bg-muted sm:border-b-0 sm:border-r px-3 font-mono text-[13px] text-muted-foreground">
                {new URL(siteConfig.url).host}/
              </span>
              <input
                id="org-slug"
                name="slug"
                type="text"
                required
                placeholder="northwind"
                pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
                aria-describedby="org-slug-hint"
                className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
            <p
              id="org-slug-hint"
              className="mt-1.5 text-xs text-muted-foreground"
            >
              Lowercase letters, numbers, and hyphens only.
            </p>
          </div>

          {createState?.error && (
            <p className="text-sm text-danger-foreground">
              {createState.error}
            </p>
          )}

          <Button
            type="submit"
            className="h-[46px] w-full rounded-[11px] text-[14.5px] font-semibold"
            disabled={createPending}
          >
            {createPending ? 'Creating…' : 'Create organization'}
          </Button>
        </form>
      )}

      {/* Join Organization Form */}
      {activeTab === 'join' && (
        <form action={joinAction} className="space-y-4">
          <div>
            <label
              htmlFor="invite-code"
              className="mb-1.5 block text-[13px] font-medium text-foreground"
            >
              Invite code
            </label>
            <Input
              id="invite-code"
              name="inviteCode"
              type="text"
              required
              placeholder="Enter your invite code"
              aria-describedby="invite-code-hint"
            />
            <p
              id="invite-code-hint"
              className="mt-1.5 text-xs text-muted-foreground"
            >
              Ask your team admin for an invite code.
            </p>
          </div>

          {joinState?.error && (
            <p className="text-sm text-danger-foreground">{joinState.error}</p>
          )}

          <Button
            type="submit"
            className="h-[46px] w-full rounded-[11px] text-[14.5px] font-semibold"
            disabled={joinPending}
          >
            {joinPending ? 'Joining…' : 'Join organization'}
          </Button>
        </form>
      )}
    </div>
  )
}
