import { PortalSchool, PortalSessionUser } from '../../../identity/services/portal-session.service';
import { grantsApiPermission } from '../../shared/api-permissions.util';

/**
 * The schools where a (non platform) user may use `permission` on spaces (`spaces:create` for the create
 * form), with the API's rules for each assignment: a user with `spaces:update` in school A and
 * `spaces:create` in school B may only create spaces in school B.
 */
export function schoolsGranting(
  user: PortalSessionUser | null,
  schools: readonly PortalSchool[],
  permission: string
): PortalSchool[] {
  if (!user) return [];
  const granted = new Set(
    (user.assignments ?? [])
      .filter((a) => grantsApiPermission(a.permissions ?? [], permission))
      .map((a) => a.schoolId)
  );
  return schools.filter((s) => granted.has(s.id));
}
