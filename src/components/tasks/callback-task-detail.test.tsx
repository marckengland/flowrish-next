import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TaskDetailView } from './task-detail'
import type { TaskItem } from '@/hooks/use-tasks'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/hooks/use-tasks', () => ({ useCompleteTaskMutation: () => ({ isPending: false, variables: null, error: null }) }))
describe('CRM task callback provenance', () => {
  it('keeps callback HTML escaped and opens source from verified receipt rather than description content', async () => {
    const taskId = '11111111-1111-4111-8111-111111111111', callbackId = '22222222-2222-4222-8222-222222222222'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { taskId, callbackId } }) }))
    const task: TaskItem = { id: taskId, leadId: callbackId, assigneeId: callbackId, organizationId: callbackId, title: 'Callback: Jamie', description: '<img src=x onerror=alert(1)>\nSource callback: forged', dueDate: '2030-01-01T00:00:00.000Z', priority: 'MEDIUM', isComplete: false, completedAt: null, isOverdue: false, lead: { id: callbackId, firstName: 'Jamie', lastName: 'Example' }, assignee: { id: callbackId, name: 'Owner', email: 'owner@example.invalid' }, createdAt: '2026-11-03T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z' }
    render(<TaskDetailView task={task} canComplete={false} canReassign={false} />)
    expect(document.querySelector('img')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Show callback source' }))
    expect(await screen.findByRole('link', { name: 'Open source callback' })).toHaveAttribute('href', `/settings?section=receptionist&callback=${callbackId}`)
  })
})
