'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Brain, Plus, Trash2, Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * AI prompt configuration component (admin).
 *
 * Allows admins to manage system prompts used by AI features:
 * - email_generation: system prompt for AI email drafting
 * - account_research: system prompt for account research
 * - chatbot: system prompt for the AI chatbot
 *
 * Each config has a key, name, system prompt text, and active toggle.
 * Only active prompts are included in AI requests.
 *
 * Validates: Requirements 8.4, 8.5
 */

interface AiPrompt {
  id: string
  key: string
  name: string
  systemPrompt: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface CreatePromptData {
  key: string
  name: string
  systemPrompt: string
}

const PROMPT_KEYS = [
  { value: 'email_generation', label: 'Email Generation' },
  { value: 'account_research', label: 'Account Research' },
  { value: 'chatbot', label: 'Chatbot' },
] as const

export function AiPromptConfig(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPrompt, setEditPrompt] = useState('')
  const [newPrompt, setNewPrompt] = useState<CreatePromptData>({
    key: 'email_generation',
    name: '',
    systemPrompt: '',
  })

  const { data: prompts, isLoading } = useQuery<AiPrompt[]>({
    queryKey: ['ai-prompt-configs'],
    queryFn: async () => {
      const res = await fetch('/api/admin/ai-prompts')
      if (!res.ok) throw new Error('Failed to fetch AI prompts')
      return (await res.json()).data
    },
  })

  const createMutation = useMutation({
    mutationFn: async (data: CreatePromptData) => {
      const res = await fetch('/api/admin/ai-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message ?? 'Failed to create prompt')
      }
      return res.json()
    },
    onSuccess: () => {
      setShowCreateForm(false)
      setNewPrompt({ key: 'email_generation', name: '', systemPrompt: '' })
      queryClient.invalidateQueries({ queryKey: ['ai-prompt-configs'] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ promptId, systemPrompt }: { promptId: string; systemPrompt: string }) => {
      const res = await fetch(`/api/admin/ai-prompts/${promptId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt }),
      })
      if (!res.ok) throw new Error('Failed to update prompt')
      return res.json()
    },
    onSuccess: () => {
      setEditingId(null)
      setEditPrompt('')
      queryClient.invalidateQueries({ queryKey: ['ai-prompt-configs'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (promptId: string) => {
      const res = await fetch(`/api/admin/ai-prompts/${promptId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete prompt')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-prompt-configs'] })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ promptId, isActive }: { promptId: string; isActive: boolean }) => {
      const res = await fetch(`/api/admin/ai-prompts/${promptId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      if (!res.ok) throw new Error('Failed to update prompt')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-prompt-configs'] })
    },
  })

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPrompt.name.trim() || !newPrompt.systemPrompt.trim()) return
    createMutation.mutate(newPrompt)
  }

  const handleEditSave = (promptId: string) => {
    if (!editPrompt.trim()) return
    updateMutation.mutate({ promptId, systemPrompt: editPrompt })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">AI prompts</h2>
        <Button
          variant="default"
          size="sm"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          <Plus className="size-4" aria-hidden="true" />
          <span>Add prompt</span>
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Configure system prompts for AI features. Only active prompts are included in AI requests.
      </p>

      {/* Create form */}
      {showCreateForm && (
        <form
          onSubmit={handleCreateSubmit}
          className="flex flex-col gap-3 rounded-md border bg-card p-4"
        >
          <h3 className="text-sm font-semibold">Add AI prompt</h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="prompt-key" className="text-xs font-medium text-muted-foreground">
                Prompt Key
              </label>
              <select
                id="prompt-key"
                value={newPrompt.key}
                onChange={(e) => setNewPrompt((prev) => ({ ...prev, key: e.target.value }))}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                {PROMPT_KEYS.map((pk) => (
                  <option key={pk.value} value={pk.value}>
                    {pk.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="prompt-name" className="text-xs font-medium text-muted-foreground">
                Display Name
              </label>
              <input
                id="prompt-name"
                type="text"
                required
                placeholder="e.g. Sales Email Prompt"
                value={newPrompt.name}
                onChange={(e) => setNewPrompt((prev) => ({ ...prev, name: e.target.value }))}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="prompt-text" className="text-xs font-medium text-muted-foreground">
              System Prompt
            </label>
            <textarea
              id="prompt-text"
              required
              rows={4}
              placeholder="You are a helpful sales assistant..."
              value={newPrompt.systemPrompt}
              onChange={(e) => setNewPrompt((prev) => ({ ...prev, systemPrompt: e.target.value }))}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Prompt'}
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
            <p className="text-xs text-danger-foreground" role="alert">
              {createMutation.error.message}
            </p>
          )}
        </form>
      )}

      {/* Prompts list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">Loading AI prompts...</p>
        </div>
      ) : !prompts || prompts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card py-12">
          <Brain className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">No AI prompts configured</p>
          <p className="text-xs text-muted-foreground">
            Add system prompts to customize AI behavior for email generation, research, and chatbot.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {prompts.map((prompt) => (
            <div
              key={prompt.id}
              className={`flex flex-col gap-2 rounded-lg border bg-card p-[18px] ${
                prompt.isActive ? '' : 'opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-foreground">
                      {prompt.name}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {prompt.key}
                    </span>
                    {!prompt.isActive && (
                      <span className="text-xs text-muted-foreground">(inactive)</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => {
                      setEditingId(editingId === prompt.id ? null : prompt.id)
                      setEditPrompt(prompt.systemPrompt)
                    }}
                    aria-label="Edit prompt"
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() =>
                      toggleMutation.mutate({ promptId: prompt.id, isActive: !prompt.isActive })
                    }
                    aria-label={prompt.isActive ? 'Deactivate prompt' : 'Activate prompt'}
                  >
                    <span className="text-xs">{prompt.isActive ? 'On' : 'Off'}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => deleteMutation.mutate(prompt.id)}
                    aria-label="Delete prompt"
                  >
                    <Trash2 className="size-3.5 text-danger-foreground" aria-hidden="true" />
                  </Button>
                </div>
              </div>

              {editingId === prompt.id ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    rows={4}
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    className="rounded-[10px] border bg-background px-3 py-2 text-[12.5px] leading-relaxed focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/15"
                    aria-label="Edit system prompt"
                  />
                  <div className="flex gap-1">
                    <Button
                      size="xs"
                      onClick={() => handleEditSave(prompt.id)}
                      disabled={updateMutation.isPending}
                    >
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-[10px] border bg-muted/40 px-3 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  {prompt.systemPrompt}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
