import type { UserStatus } from '@prisma/client';

/** One role the user holds, where it applies, and what it allows. */
export interface AuthRoleAssignment {
  role: string;
  /** 'platform' roles apply to every school; 'school' / 'group' roles only to `schoolId`. */
  scope: string;
  schoolId: string;
  schoolStatus?: string | null;
  groupId: string | null;
  permissions: string[];
}

/**
 * The logged-in user, rebuilt from the database on every request (never trusted from the
 * token), so role changes and suspensions apply immediately. Available as `@CurrentUser()`.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  status: UserStatus;
  assignments: AuthRoleAssignment[];
  /** Union of the permissions of all assignments. */
  permissions: string[];
  /** Schools the user has any role in. */
  schoolIds: string[];
  /** Holds a platform-scoped role: acts on every school. */
  isPlatformAdmin: boolean;
  /** Primary role / school (first assignment), e.g. for audit records. */
  role: string | null;
  schoolId: string | null;
  /** Session id carried by the token, if any (set by #12). */
  sessionId: string | null;
}

export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  type: 'access';
  /** Session id (#12). */
  sid?: string;
}
