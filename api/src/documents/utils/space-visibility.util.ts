import type { Prisma } from '@prisma/client';
import { schoolsWithPermission } from '../../auth/utils/school-scope.util.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { ACTIVE_DOCUMENT, ACTIVE_SPACE } from './active-space.util.js';
import { AVAILABLE_STATUS } from './document-filters.util.js';
import { matchingAccessRulesWhere } from './document-visibility.util.js';

/**
 * WHO SEES WHAT (Section 4.7, #99). ONE rule, shared by the space list and the space detail.
 * Build the context with `buildVisibilityContext`, then use one of the two where-builders below.
 *
 * Tier 1 - platform scope: every space.
 * Tier 2 - `documents:manage` in school S (school admin, content manager): every space of S, even with no document.
 * Tier 3 - any other assignment granting `spaces:read` in school S: only spaces holding at least one active
 *   document with an `available` version and a `document_access` rule matching `matchingAccessRulesWhere`.
 *   A guest (`PARENT_GUEST`) never matches school-wide (`targetType: 'school'`) rules.
 */

/** Role name whose members only see what is explicitly shared with them. */
export const GUEST_ROLE = 'PARENT_GUEST';

/** Status of a document version that is ready to be read and retrieved. */
export const AVAILABLE_VERSION_STATUS = AVAILABLE_STATUS;

/** Per-school Tier 3 access matcher derived from the user's non-manager assignments holding `spaces:read`. */
export interface PublishedGrant {
  schoolId: string;
  isGuest: boolean;
  accessWhere: Prisma.DocumentAccessWhereInput;
}

export interface VisibilityContext {
  /** Tier 1. */
  all: boolean;
  /** Tier 2: schools where the user holds `documents:manage`. */
  manageSchoolIds: string[];
  /** Tier 3: one grant per non-manager school where the user holds `spaces:read`. */
  grants: PublishedGrant[];
}

/** Matches nothing. */
const NOTHING_ID = { in: [] as string[] };

/**
 * Builds the context from the authenticated user. Only schools where the user holds `documents:manage` (Tier 2)
 * or `spaces:read` (Tier 3) are included; another school assignment lacking `spaces:read` grants no visibility.
 */
export function buildVisibilityContext(user: AuthenticatedUser): VisibilityContext {
  const manage = schoolsWithPermission(user, 'documents:manage');
  if (manage === 'all') return { all: true, manageSchoolIds: [], grants: [] };

  const readable = schoolsWithPermission(user, 'spaces:read');
  const bySchool = new Map<string, typeof user.assignments>();
  for (const a of user.assignments) {
    if (!a.schoolId || manage.includes(a.schoolId)) continue;
    if (readable !== 'all' && !readable.includes(a.schoolId)) continue;
    const list = bySchool.get(a.schoolId) ?? [];
    list.push(a);
    bySchool.set(a.schoolId, list);
  }

  const grants: PublishedGrant[] = [...bySchool].map(([schoolId, assignments]) => {
    const isGuest = assignments.every((a) => a.role === GUEST_ROLE);
    const branchActor: AuthenticatedUser = {
      ...user,
      assignments,
      schoolIds: [schoolId],
    };
    const baseAccess = matchingAccessRulesWhere(branchActor);
    const accessWhere: Prisma.DocumentAccessWhereInput = isGuest
      ? { AND: [baseAccess, { NOT: { targetType: 'school' } }] }
      : baseAccess;
    return { schoolId, isGuest, accessWhere };
  });

  return { all: false, manageSchoolIds: manage, grants };
}

/**
 * Documents published to the user through tier 3 (no tier 1/2 shortcut): active, available and matching
 * `matchingAccessRulesWhere`.
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
          access: { some: g.accessWhere },
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
  // `search` is already trimmed by ListSpacesQueryDto; an empty one is ignored.
  if (filters.search) and.push({ name: { contains: filters.search } });

  return and.length > 0 ? { ...ACTIVE_SPACE, AND: and } : { ...ACTIVE_SPACE };
}
