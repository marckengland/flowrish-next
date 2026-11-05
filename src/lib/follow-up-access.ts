import { WORKSPACE_HEADER } from './workspace-context'
export const FOLLOW_UP_SCOPE_HEADER = 'x-flowrish-follow-up-scope'
export const FOLLOW_UP_ACCESS_EVENT = 'flowrish:follow-up-access-lost'
export interface FollowUpContext { organizationId: string; userId: string }
export const followUpHeaders = (context: FollowUpContext) => ({ [WORKSPACE_HEADER]: context.organizationId, [FOLLOW_UP_SCOPE_HEADER]: JSON.stringify([context.organizationId, context.userId]) })
