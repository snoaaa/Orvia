/**
 * Administrative level of a role, derived from its scope: a platform role outranks a school role,
 * which outranks a group role. Used to stop an admin from acting on someone above them
 * (Section 4.6, e.g. a school admin suspending a platform admin).
 */
const SCOPE_LEVELS: Readonly<Record<string, number>> = {
  platform: 3,
  school: 2,
  group: 1,
};

/** Level of one role scope, case-insensitive; an unknown, empty or missing scope ranks lowest (0). */
export function roleScopeLevel(scope: string | null | undefined): number {
  return SCOPE_LEVELS[scope?.toLowerCase() ?? ''] ?? 0;
}

/** Highest level among `scopes`; 0 when there are none. */
export function highestRoleLevel(scopes: readonly string[]): number {
  return Math.max(0, ...scopes.map(roleScopeLevel));
}
