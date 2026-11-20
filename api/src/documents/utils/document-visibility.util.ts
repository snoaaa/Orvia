import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { schoolsWithPermission } from '../../auth/utils/school-scope.util.js';
import { AVAILABLE_STATUS, type DocumentStatus, type DocumentType, typeWhere } from './document-filters.util.js';

/** The kinds of target a document can be published to (#109). */
export const DOCUMENT_ACCESS_TARGET_TYPES = ['school', 'role', 'class', 'group', 'user'] as const;
export type DocumentAccessTargetType = (typeof DOCUMENT_ACCESS_TARGET_TYPES)[number];

/**
 * Publication rules that give `actor` access (#109). A rule only counts in a school where the actor still
 * holds an active assignment, so someone who left the school loses its documents even if a rule names them.
 * - school: everyone in that school;
 * - role: everyone holding that role in that school;
 * - class / group: members of the group (group_members) or users assigned to it (user_assignments.group_id);
 * - user: that one person, e.g. a parent or guest the document is shared with explicitly.
 */
export function matchingAccessRulesWhere(actor: AuthenticatedUser): Prisma.DocumentAccessWhereInput {
  const rolesBySchool = new Map<string, Set<string>>();
  for (const assignment of actor.assignments) {
    if (assignment.scope === 'platform' || !assignment.schoolId) continue;
    const roles = rolesBySchool.get(assignment.schoolId) ?? new Set<string>();
    roles.add(assignment.role);
    rolesBySchool.set(assignment.schoolId, roles);
  }

  const inMySchools = { in: actor.schoolIds };
  return {
    schoolId: inMySchools,
    OR: [
      { targetType: 'school' },
      ...[...rolesBySchool].map(([schoolId, roles]) => ({
        targetType: 'role',
        schoolId,
        role: { name: { in: [...roles] } },
      })),
      {
        targetType: { in: ['class', 'group'] },
        group: {
          deletedAt: null,
          OR: [
            { members: { some: { userId: actor.id } } },
            { assignments: { some: { userId: actor.id, deletedAt: null } } },
          ],
        },
      },
      { targetType: 'user', userId: actor.id },
    ],
  };
}

/**
 * Prisma filter for the documents `actor` may see (#109), or `undefined` when they see every document
 * (platform admins). Document managers (`documents:manage`) see every document of their schools, published
 * or not, in any status; everyone else only the documents published to them that have a processed version
 * (status 'available', #111), so readers never see a document still in processing. A document without any
 * rule is a draft: only its managers see it.
 *
 * Meant to be shared by every reader: the document details and downloads now, the document lists (#111)
 * and the retrieval step of the chat, which must apply it before generating an answer.
 * Combine it with the caller's own conditions under `AND`, never by spreading it (both may use `OR`).
 */
/**
 * The `status` and `type` filters of the document list (#111), applied to the versions each caller may see:
 * - in the schools where the caller manages documents (or everywhere for platform admins), to the current version;
 * - elsewhere the caller only ever sees available versions, so `status` other than `available` matches nothing
 *   there, and `type` matches when one of the document's available versions has that type.
 * Undefined when neither filter is given.
 */
export function versionFiltersWhere(
  actor: AuthenticatedUser,
  status?: DocumentStatus,
  type?: DocumentType,
): Prisma.DocumentWhereInput | undefined {
  if (!status && !type) return undefined;
  const currentVersion: Prisma.DocumentVersionWhereInput = { ...(status ? { status } : {}), ...(type ? typeWhere(type) : {}) };
  const managed = schoolsWithPermission(actor, 'documents:manage');
  if (managed === 'all') return { currentVersion };

  const asManager: Prisma.DocumentWhereInput[] =
    managed.length > 0 ? [{ space: { schoolId: { in: managed } }, currentVersion }] : [];
  const asReader: Prisma.DocumentWhereInput[] =
    !status || status === AVAILABLE_STATUS
      ? [
          {
            ...(managed.length > 0 ? { space: { schoolId: { notIn: managed } } } : {}),
            versions: { some: { status: AVAILABLE_STATUS, ...(type ? typeWhere(type) : {}) } },
          },
        ]
      : [];
  const parts = [...asManager, ...asReader];
  // A reader asking for a processing status: nothing can match.
  return parts.length > 0 ? { OR: parts } : { id: { in: [] } };
}

export function visibleDocumentsWhere(actor: AuthenticatedUser): Prisma.DocumentWhereInput | undefined {
  const managed = schoolsWithPermission(actor, 'documents:manage');
  if (managed === 'all') return undefined;
  return {
    OR: [
      ...(managed.length > 0 ? [{ space: { schoolId: { in: managed } } }] : []),
      { access: { some: matchingAccessRulesWhere(actor) }, versions: { some: { status: AVAILABLE_STATUS } } },
    ],
  };
}

/** Same rule as {@link visibleDocumentsWhere}, for one document. Deleted documents are never visible. */
export async function isDocumentVisibleTo(
  prisma: { document: { findFirst(args: Prisma.DocumentFindFirstArgs): Promise<{ id: string } | null> } },
  actor: AuthenticatedUser,
  documentId: string,
): Promise<boolean> {
  const visible = visibleDocumentsWhere(actor);
  const found = await prisma.document.findFirst({
    where: { AND: [{ id: documentId, deletedAt: null }, ...(visible ? [visible] : [])] },
    select: { id: true },
  });
  return found !== null;
}
