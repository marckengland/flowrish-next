export const WORKSPACE_COOKIE = 'flowrish_workspace'
export const WORKSPACE_HEADER = 'x-flowrish-workspace'
export const WORKSPACE_METHOD_HEADER = 'x-flowrish-request-method'
export const WORKSPACE_PATH_HEADER = 'x-flowrish-request-path'
export const WORKSPACE_EVENT = 'flowrish:workspace-change'

// This cookie is a selector, never a credential. Membership is checked separately.
export function selectedWorkspace(value: string | undefined, authId: string) {
  if (!value) return undefined
  const [owner, organizationId, extra] = value.split(':')
  if (
    owner !== authId ||
    extra !== undefined ||
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(organizationId ?? '')
  )
    return undefined
  return organizationId
}
