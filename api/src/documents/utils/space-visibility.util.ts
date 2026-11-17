import type { Prisma } from '@prisma/client';
import { schoolsWithPermission } from '../../auth/utils/school-scope.util.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { ACTIVE_DOCUMENT, ACTIVE_SPACE } from './active-space.util.js';

/**
 * WHO SEES WHAT (Section 4.7, #99). ONE rule, shared by the space list, the space detail and (#111) the document
 * list. Build the context with `buildVisibilityContext`, then use one of the two where-builders below.
 *
 * Tier 1 - platform scope: every space.
 * Tier 2 - `documents:manage` in school S (school admin, content manager): every space of S, even with no document.
 * Tier 3 - any other assignment (staff, student, guest) in school S: only the documents "published to them".
 *
 * A `document_access` row is published to an assignment (school S, role R, groups G) when ALL hold:
 *  - the document's space is in S and `row.school_id = S` (a row with `school_id = NULL` matches nobody);
 *  - `row.role_id` is NULL or equals R;
 *  - `row.group_id` is NULL or is in G (the assignment's own group plus the user's non-deleted `group_members`).
 * So a row with only `school_id` means "the whole school": staff and students, NOT guests. A guest (PARENT_GUEST)
 * needs an explicit row: `role_id` or `group_id` must be set (and match), so sharing is by guest role or by group.
 * (document_access has no user column: sharing with one single person is not possible yet.)
 *
 * A document counts only when it is not deleted, in a non-deleted space (ACTIVE_DOCUMENT) and has an `indexed`
 * version: a document still being processed cannot be opened or retrieved yet.
 */

/** Role name whose members only see what is explicitly shared with them. */
export const GUEST_ROLE = 'PARENT_GUEST';

/** Status of a document version that is ready to be read and retrieved. */
export const AVAILABLE_VERSION_STATUS = 'indexed';

/** One assignment of the user in a school, with the groups it gives access to. */
export interface PublishedGrant {
  schoolId: string;
  roleId?: string;
  isGuest: boolean;
  groupIds: string[];
}

export interface VisibilityContext {
  /** Tier 1. */
  all: boolean;
  /** Tier 2: schools where the user holds `documents:manage`. */
  manageSchoolIds: string[];
  /** Tier 3: one grant per remaining assignment. */
  grants: PublishedGrant[];
}

/** Matches nothing. */
const NOTHING_ID = { in: [] as string[] };

/** True when tier 3 applies, i.e. the caller's groups must be loaded. */
export function needsGroups(user: AuthenticatedUser): boolean {
  const manage = schoolsWithPermission(user, 'documents:manage');
  return manage !== 'all' && user.assignments.some((a) => !manage.includes(a.schoolId));
}

/**
 * Builds the context from the authenticated user. `groupIdsBySchool` holds the user's NON-DELETED groups per school
 * (the group of the assignment and `group_members`): the caller loads them, because a soft-deleted group must not
 * keep giving access.
 */
export function buildVisibilityContext(
  user: AuthenticatedUser,
  groupIdsBySchool: ReadonlyMap<string, readonly string[]> = new Map(),
): VisibilityContext {
  const manage = schoolsWithPermission(user, 'documents:manage');
  if (manage === 'all') return { all: true, manageSchoolIds: [], grants: [] };
  const grants = user.assignments
    .filter((a) => !manage.includes(a.schoolId))
    .map((a) => ({
      schoolId: a.schoolId,
      roleId: a.roleId,
      isGuest: a.role === GUEST_ROLE,
      groupIds: [...(groupIdsBySchool.get(a.schoolId) ?? [])],
    }));
  return { all: false, manageSchoolIds: manage, grants };
}

/** The `document_access` rows published to one grant (see the rule above). */
function accessRowFor(grant: PublishedGrant): Prisma.DocumentAccessWhereInput {
  const roleMatch: Prisma.DocumentAccessWhereInput[] = [{ roleId: null }];
  if (grant.roleId) roleMatch.push({ roleId: grant.roleId });
  const groupMatch: Prisma.DocumentAccessWhereInput[] = [{ groupId: null }];
  if (grant.groupIds.length > 0) groupMatch.push({ groupId: { in: grant.groupIds } });
  return {
    schoolId: grant.schoolId,
    AND: [{ OR: roleMatch }, { OR: groupMatch }],
    ...(grant.isGuest ? { NOT: { roleId: null, groupId: null } } : {}),
  };
}

/**
 * Documents published to the user through tier 3 (no tier 1/2 shortcut): active, available and matching a
 * `document_access` row. Reuse it for the document list (#111), adding the tier 1/2 clauses there.
 */
export function buildPublishedDocumentWhere(grants: readonly PublishedGrant[]): Prisma.DocumentWhereInput {
  if (grants.length === 0) return { id: NOTHING_ID };
  return {
    AND: [
      ACTIVE_DOCUMENT,
      { versions: { some: { status: AVAILABLE_VERSION_STATUS } } },
      {
        OR: grants.map((g) => ({
          space: { schoolId: g.schoolId },
          access: { some: accessRowFor(g) },
        })),
      },
    ],
  };
}

/** Where clause for `space`: active, visible to the user, optionally restricted to one school and a name search. */
export function buildVisibleSpacesWhere(
  ctx: VisibilityContext,
  filters: { schoolId?: string; search?: string } = {},
): Prisma.SpaceWhereInput {
  const and: Prisma.SpaceWhereInput[] = [];

  if (!ctx.all) {
    const tiers: Prisma.SpaceWhereInput[] = [];
    if (ctx.manageSchoolIds.length > 0) tiers.push({ schoolId: { in: ctx.manageSchoolIds } });
    if (ctx.grants.length > 0) tiers.push({ documents: { some: buildPublishedDocumentWhere(ctx.grants) } });
    and.push(tiers.length > 0 ? { OR: tiers } : { id: NOTHING_ID });
  }
  if (filters.schoolId) and.push({ schoolId: filters.schoolId });
  const search = filters.search?.trim();
  if (search) and.push({ name: { contains: search } });

  return and.length > 0 ? { ...ACTIVE_SPACE, AND: and } : { ...ACTIVE_SPACE };
}
