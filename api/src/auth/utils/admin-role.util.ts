/**
 * Administrative classification.
 *
 * The admin login used to accept an account when a role was platform-scoped **or literally named
 * `SCHOOL_ADMIN`**, so any other school-scoped admin role (a custom one, for example) could never
 * authenticate even when it held the right permissions.
 *
 * Admin-ness is now derived from data instead:
 *  - every platform-scoped role is an admin role (it applies to all schools);
 *  - a school/group role is an admin role when it grants at least one of `ADMIN_PERMISSIONS`,
 *    i.e. it can administer identities or the school itself.
 *
 * Content roles (`CONTENT_MANAGER`, `STAFF`) deliberately stay non-admin: none of their
 * permissions appear below, so they keep using Google login.
 */
export const ADMIN_PERMISSIONS: readonly string[] = [
  'users:assign_role',
  'users:invite',
  'users:create',
  'users:update',
  'users:suspend',
  'schools:update',
];

/** The shape needed to classify one role assignment: its scope and its permission codes. */
export interface ClassifiableRole {
  scope: string;
  permissions: readonly string[];
}

/** True when holding this role grants administrative access (see the module comment). */
export function isAdminRole(role: ClassifiableRole): boolean {
  if (role.scope === 'platform') return true;
  return role.permissions.some((permission) => ADMIN_PERMISSIONS.includes(permission));
}

/** True when at least one of `roles` is an admin role. */
export function hasAdminAccess(roles: readonly ClassifiableRole[]): boolean {
  return roles.some(isAdminRole);
}

/** The part of a Prisma `assignments` row (with `role.rolePermissions` included) we classify on. */
export interface AssignmentWithRole {
  role: {
    scope: string;
    rolePermissions?: ReadonlyArray<{ permission: { code: string } }>;
  };
}

/** Maps Prisma assignments to `ClassifiableRole`s; a missing include counts as "no permissions". */
export function toClassifiableRoles(assignments: readonly AssignmentWithRole[]): ClassifiableRole[] {
  return assignments.map((a) => ({
    scope: a.role.scope,
    permissions: a.role.rolePermissions?.map((rp) => rp.permission.code) ?? [],
  }));
}
