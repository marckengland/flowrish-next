import { beforeEach, describe, expect, it } from 'vitest'

import { useKanbanStore } from './kanban'

/**
 * Unit tests for the Zustand kanban drag-state store.
 *
 * Validates: Requirements 17.1, 17.2, 26.4
 */
describe('useKanbanStore', () => {
  beforeEach(() => {
    useKanbanStore.setState({ draggingLeadId: null, dragOverStageId: null })
  })

  it('defaults to no active drag and no drop target', () => {
    const state = useKanbanStore.getState()
    expect(state.draggingLeadId).toBeNull()
    expect(state.dragOverStageId).toBeNull()
  })

  it('startDrag records the lead ID and clears any previous drop target', () => {
    useKanbanStore.setState({ dragOverStageId: 'stage-old' })
    useKanbanStore.getState().startDrag('lead-1')
    expect(useKanbanStore.getState().draggingLeadId).toBe('lead-1')
    expect(useKanbanStore.getState().dragOverStageId).toBeNull()
  })

  it('setDragOverStage updates the hovered drop target', () => {
    useKanbanStore.getState().setDragOverStage('stage-2')
    expect(useKanbanStore.getState().dragOverStageId).toBe('stage-2')

    useKanbanStore.getState().setDragOverStage(null)
    expect(useKanbanStore.getState().dragOverStageId).toBeNull()
  })

  it('endDrag resets both drag and drop-target state', () => {
    useKanbanStore.getState().startDrag('lead-1')
    useKanbanStore.getState().setDragOverStage('stage-3')
    useKanbanStore.getState().endDrag()
    expect(useKanbanStore.getState().draggingLeadId).toBeNull()
    expect(useKanbanStore.getState().dragOverStageId).toBeNull()
  })
})
