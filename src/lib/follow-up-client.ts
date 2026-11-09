'use client'
import type { FollowUpContext } from './follow-up-access'
export class FollowUpClientError extends Error { constructor(message: string, public status: number, public code: string) { super(message) } }
export const followUpAccessLost = (error: unknown) => error instanceof FollowUpClientError && ([401, 403, 404].includes(error.status) || /CONTEXT|WORKSPACE/.test(error.code))
export async function followUpData<T>(response: Response, context?: FollowUpContext): Promise<{ data: T; canWrite: boolean | undefined; taskProgress?: true; taskOrder?: true; inboxCounts?: true; composeDrafts?: true; sendResults?: true; sendStatus?: true; sendResult?: unknown; page?: unknown }> {
  const value = await response.json()
  if (!response.ok) throw new FollowUpClientError(value.error?.message ?? 'Follow-ups are unavailable. Try again.', response.status, value.error?.code ?? '')
  if (context && (value.scope?.organizationId !== context.organizationId || value.scope?.userId !== context.userId)) throw new FollowUpClientError('The account or business changed. Reload before continuing.', 409, 'FOLLOW_UP_CONTEXT_CHANGED')
  if (context && typeof value.capabilities?.canWrite !== 'boolean') throw new FollowUpClientError('Current permissions could not be verified. Reload before continuing.', 409, 'FOLLOW_UP_CONTEXT_CHANGED')
  return { data: value.data as T, ...(value.capabilities?.sendStatus===true?{sendStatus:true as const}:{}), ...(value.sendResult===undefined?{}:{sendResult:value.sendResult}), ...(value.capabilities?.sendResults===true?{sendResults:true as const}:{}), ...(value.capabilities?.taskProgress === true ? { taskProgress: true as const } : {}), ...(value.capabilities?.taskOrder === true ? { taskOrder: true as const } : {}), ...(value.capabilities?.inboxCounts === true ? { inboxCounts: true as const } : {}), ...(value.capabilities?.composeDrafts === true ? { composeDrafts: true as const } : {}), ...(value.page === undefined ? {} : { page: value.page }), canWrite: value.capabilities?.canWrite }
}
