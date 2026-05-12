/**
 * Permission types for role-based access control.
 *
 * Each permission maps to a specific capability within the application.
 * Permissions are assigned to Roles, and users inherit permissions
 * from all their team memberships (union of all role permissions).
 */

export const PERMISSIONS = [
  'leads:read',
  'leads:write',
  'leads:delete',
  'contacts:read',
  'contacts:write',
  'cadences:manage',
  'cadences:read',
  'users:invite',
  'users:manage',
  'billing:manage',
  'settings:manage',
  'audit:read',
  'forecast:read',
  'forecast:submit',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/**
 * Default role hierarchy — lower number = more powerful.
 */
export const ROLE_HIERARCHY = {
  OWNER: 0,
  ADMIN: 1,
  MANAGER: 2,
  MEMBER: 3,
} as const

export type DefaultRole = keyof typeof ROLE_HIERARCHY

/**
 * Default permissions for each system role.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<DefaultRole, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  ADMIN: [
    'leads:read',
    'leads:write',
    'leads:delete',
    'contacts:read',
    'contacts:write',
    'cadences:manage',
    'cadences:read',
    'users:invite',
    'users:manage',
    'settings:manage',
    'audit:read',
    'forecast:read',
    'forecast:submit',
  ],
  MANAGER: [
    'leads:read',
    'leads:write',
    'leads:delete',
    'contacts:read',
    'contacts:write',
    'cadences:manage',
    'cadences:read',
    'forecast:read',
    'forecast:submit',
  ],
  MEMBER: [
    'leads:read',
    'leads:write',
    'contacts:read',
    'contacts:write',
    'cadences:read',
    'forecast:read',
  ],
} as const
