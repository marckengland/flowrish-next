import { create } from 'zustand'

/**
 * Client-side UI state for the pipeline Kanban board.
 *
 * Tracks the transient drag state for the drag-and-drop experience:
 * - `draggingLeadId`: The ID of the lead currently being dragged, or null
 *   when no drag is in progress.
 * - `dragOverStageId`: The stage column currently being hovered as a drop
 *   target, or null. Columns read this to highlight themselves while a
 *   drop is imminent.
 *
 * This Zustand store is a module-level singleton — no provider required —
 * consistent with how `layout` and `filters` stores are wired in this
 * project (Requirement 26.4: use Zustand for client UI state).
 *
 * The actual lead-to-stage mutation flows through TanStack Query via the
 * existing `/api/leads/[id]/move` endpoint; the drag state here is purely
 * for visual feedback during the interaction.
 *
 * Validates: Requirements 17.1, 17.2, 17.4, 17.5, 26.4
 */
export interface KanbanState {
  /** ID of the lead currently being dragged. Null when no drag is active. */
  draggingLeadId: string | null
  /** ID of the stage column currently being hovered during a drag. */
  dragOverStageId: string | null
  /** Start tracking a drag for the given lead. */
  startDrag: (leadId: string) => void
  /** Clear the drag state (drop or cancel). */
  endDrag: () => void
  /** Mark a stage column as the current drop target (or clear with null). */
  setDragOverStage: (stageId: string | null) => void
}

export const useKanbanStore = create<KanbanState>((set) => ({
  draggingLeadId: null,
  dragOverStageId: null,
  startDrag: (leadId) =>
    set({ draggingLeadId: leadId, dragOverStageId: null }),
  endDrag: () => set({ draggingLeadId: null, dragOverStageId: null }),
  setDragOverStage: (stageId) => set({ dragOverStageId: stageId }),
}))
