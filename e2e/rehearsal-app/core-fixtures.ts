import type { LeadListItem } from '@/hooks/use-leads'
import type { TaskItem } from '@/hooks/use-tasks'
export const coreIds = {
  lead: '11111111-1111-4111-8111-111111111111',
  task: '22222222-2222-4222-8222-222222222222',
  user: '33333333-3333-4333-8333-333333333333',
  stage: '44444444-4444-4444-8444-444444444444',
  organization: '55555555-5555-4555-8555-555555555555',
}
export const coreStages = [{ id: coreIds.stage, name: 'New', order: 1 }]
export function coreLead(): LeadListItem {
  return {
    id: coreIds.lead,
    firstName: 'Practice',
    lastName: 'Prospect',
    email: 'practice@example.test',
    phone: null,
    title: null,
    dealValue: 500,
    currency: 'PHP',
    score: 60,
    leadStatus: 'NEW',
    tier: null,
    companyName: 'Practice Studio',
    stageId: coreIds.stage,
    assignedUserId: coreIds.user,
    lastActivityAt: null,
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z',
    stage: { ...coreStages[0], isClosedWon: false, isClosedLost: false },
    assignedUser: {
      id: coreIds.user,
      name: 'Practice Owner',
      email: 'owner@example.test',
    },
  }
}
export function coreTask(): TaskItem {
  return {
    id: coreIds.task,
    title: 'Review practice proposal',
    description: 'Synthetic task for the isolated audit.',
    priority: 'MEDIUM',
    dueDate: '2026-11-04T01:00:00.000Z',
    isComplete: false,
    completedAt: null,
    leadId: coreIds.lead,
    assigneeId: coreIds.user,
    organizationId: coreIds.organization,
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z',
    isOverdue: true,
    lead: { id: coreIds.lead, firstName: 'Practice', lastName: 'Prospect' },
    assignee: {
      id: coreIds.user,
      name: 'Practice Owner',
      email: 'owner@example.test',
    },
  }
}
