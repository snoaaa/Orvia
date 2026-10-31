import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

/** Schools where `user` may use `permission`, or 'all' for platform-wide roles. */
export function schoolsWithPermission(user: AuthenticatedUser, permission: string): 'all' | string[] {
  const granting = user.assignments.filter((a) => a.permissions.includes(permission));
  if (granting.some((a) => a.scope === 'platform')) return 'all';
  return [...new Set(granting.map((a) => a.schoolId))];
}

/** True if `user` may use `permission` in `schoolId`. */
export function canInSchool(user: AuthenticatedUser, permission: string, schoolId: string): boolean {
  const schools = schoolsWithPermission(user, permission);
  return schools === 'all' || schools.includes(schoolId);
}

/**
 * Throws 403 unless `user` may use `permission` in at least one of `schoolIds`.
 * Platform-wide roles always pass, even for data not attached to any school yet.
 * Use it before reading or changing anything that belongs to a school.
 */
export function assertSchoolAccess(
  user: AuthenticatedUser,
  permission: string,
  schoolIds: string | (string | null | undefined)[],
): void {
  if (schoolsWithPermission(user, permission) === 'all') return;
  const targets = (Array.isArray(schoolIds) ? schoolIds : [schoolIds]).filter((s): s is string => !!s);
  if (targets.some((schoolId) => canInSchool(user, permission, schoolId))) return;
  throw new ForbiddenException('You do not have access to this school');
}

/**
 * Prisma-style filter value for list queries: `undefined` = no restriction (platform admin),
 * otherwise `{ in: [...] }` with the allowed school ids.
 */
export function schoolIdFilter(
  user: AuthenticatedUser,
  permission: string,
): { in: string[] } | undefined {
  const schools = schoolsWithPermission(user, permission);
  return schools === 'all' ? undefined : { in: schools };
}
