'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { FollowUpContext } from '@/lib/follow-up-access'

const WorkspaceIdentity = createContext<FollowUpContext | undefined>(undefined)
export function WorkspaceIdentityProvider({ organizationId, userId, children }: { organizationId?: string; userId?: string; children: ReactNode }): React.JSX.Element {
  const value = useMemo(() => organizationId && userId ? { organizationId, userId } : undefined, [organizationId, userId])
  return <WorkspaceIdentity.Provider value={value}>{children}</WorkspaceIdentity.Provider>
}
export const useWorkspaceIdentity = () => useContext(WorkspaceIdentity)
