/**
 * RBAC permission matrix — defines what each org role can do.
 *
 * Roles (highest to lowest privilege):
 *   owner    — full access, can delete org, manage billing
 *   admin    — manage members, settings, all invoice operations
 *   reviewer — view, upload, approve/reject invoices
 *   viewer   — read-only access to invoices and analytics
 *   api_user — OCR API access only (sync/async endpoints)
 *
 * Usage in middleware/controllers:
 *   import { can } from '../shared/roles.js';
 *   if (!can(user.orgRole, 'invoice:upload')) throw new ForbiddenError();
 */
import type { OrgRole } from '../tenant/models/index.js';

export type Permission =
  | 'invoice:list'
  | 'invoice:detail'
  | 'invoice:upload'
  | 'invoice:edit'
  | 'invoice:delete'
  | 'invoice:reextract'
  | 'invoice:approve'
  | 'invoice:export'
  | 'invoice:api_sync'
  | 'invoice:api_async'
  | 'analytics:view'
  | 'fraud:view'
  | 'vendor:list'
  | 'vendor:detail'
  | 'settings:view'
  | 'settings:edit'
  | 'members:list'
  | 'members:invite'
  | 'members:remove'
  | 'members:change_role'
  | 'org:edit'
  | 'org:delete'
  | 'billing:view'
  | 'billing:manage';

/**
 * Permission matrix. Each role maps to its allowed actions.
 * A role inherits nothing — permissions are explicit.
 */
const PERMISSION_MATRIX: Record<OrgRole, readonly Permission[]> = {
  owner: [
    'invoice:list', 'invoice:detail', 'invoice:upload', 'invoice:edit',
    'invoice:delete', 'invoice:reextract', 'invoice:approve', 'invoice:export',
    'invoice:api_sync', 'invoice:api_async',
    'analytics:view', 'fraud:view',
    'vendor:list', 'vendor:detail',
    'settings:view', 'settings:edit',
    'members:list', 'members:invite', 'members:remove', 'members:change_role',
    'org:edit', 'org:delete',
    'billing:view', 'billing:manage',
  ],

  admin: [
    'invoice:list', 'invoice:detail', 'invoice:upload', 'invoice:edit',
    'invoice:delete', 'invoice:reextract', 'invoice:approve', 'invoice:export',
    'invoice:api_sync', 'invoice:api_async',
    'analytics:view', 'fraud:view',
    'vendor:list', 'vendor:detail',
    'settings:view', 'settings:edit',
    'members:list', 'members:invite', 'members:remove', 'members:change_role',
    'billing:view',
  ],

  reviewer: [
    'invoice:list', 'invoice:detail', 'invoice:upload', 'invoice:edit',
    'invoice:reextract', 'invoice:approve', 'invoice:export',
    'analytics:view', 'fraud:view',
    'vendor:list', 'vendor:detail',
  ],

  viewer: [
    'invoice:list', 'invoice:detail', 'invoice:export',
    'analytics:view',
    'vendor:list', 'vendor:detail',
  ],

  api_user: [
    'invoice:api_sync', 'invoice:api_async',
    'invoice:list', 'invoice:detail',
  ],
};

/** Check if a role has a specific permission. */
export function can(role: OrgRole, permission: Permission): boolean {
  const allowed = PERMISSION_MATRIX[role];
  if (!allowed) return false;
  return allowed.includes(permission);
}

/** Get all permissions for a role. */
export function permissionsFor(role: OrgRole): readonly Permission[] {
  return PERMISSION_MATRIX[role] ?? [];
}

/** All defined roles in privilege order (highest first). */
export const ROLE_HIERARCHY: readonly OrgRole[] = ['owner', 'admin', 'reviewer', 'viewer', 'api_user'];
