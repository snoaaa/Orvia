import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../types/authenticated-user.js';
import { highestRoleLevel, roleScopeLevel } from './role-level.util.js';
import { assertSchoolAccess } from './school-scope.util.js';

/** Permission needed to give someone a role (POST /assignments, PATCH /identity/users/:id/role). */
export const ASSIGN_ROLE_PERMISSION = 'users:assign_role';

/**
 * Highest role level `actor` may grant: the level of their own roles that carry `users:assign_role`
 * (see `role-level.util.ts`). With `schoolId`, only the roles that apply there count: platform
 * roles, or roles held in that school.
 */
export function grantableRoleLevel(actor: AuthenticatedUser, schoolId?: string): number {
  return highestRoleLevel(
    actor.assignments
      .filter((a) => a.permissions.includes(ASSIGN_ROLE_PERMISSION))
      .filter((a) => schoolId === undefined || a.scope === 'platform' || a.schoolId === schoolId)
      .map((a) => a.scope),
  );
}

/**
 * Throws 403 unless `actor` may grant `role` in `schoolId` (Sections 4.5 and 4.7, no privilege escalation):
 * they need `users:assign_role` in that school, and the role must be at or below their own level
 * (a school admin can grant school and group roles, only a platform admin can grant a platform role).
 */
export function assertCanGrantRole(
  actor: AuthenticatedUser,
  role: { name: string; scope: string },
  schoolId: string,
): void {
  assertSchoolAccess(actor, ASSIGN_ROLE_PERMISSION, schoolId);
  if (roleScopeLevel(role.scope) > grantableRoleLevel(actor, schoolId)) {
    throw new ForbiddenException(
      role.scope === 'platform'
        ? `Only a platform administrator can assign the ${role.name} role`
        : `You cannot assign the ${role.name} role: it is above your own level`,
    );
  }
}
