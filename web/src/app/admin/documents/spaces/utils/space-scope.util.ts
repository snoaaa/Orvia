import { DOCUMENT_MANAGEMENT_PERMISSIONS } from 'src/app/admin/theme/layouts/admin-layout/navigation/navigation';
import { PortalSchool, PortalSessionUser } from '../../../identity/services/portal-session.service';

/**
 * The schools where a (non platform) user may create, edit and delete spaces: those where one of their
 * assignments grants a document-management permission, which the API accepts for `spaces:*` (#88, #97).
 */
export function schoolsManagingSpaces(
  user: PortalSessionUser | null,
  schools: readonly PortalSchool[]
): PortalSchool[] {
  if (!user) return [];
  const managed = new Set(
    (user.assignments ?? [])
      .filter((a) => (a.permissions ?? []).some((p) => DOCUMENT_MANAGEMENT_PERMISSIONS.has(p)))
      .map((a) => a.schoolId)
  );
  return schools.filter((s) => managed.has(s.id));
}
