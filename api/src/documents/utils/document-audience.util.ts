import type { Prisma } from '@prisma/client';
import { DOCUMENT_MANAGER_PERMISSION_CODES } from '../../auth/utils/school-scope.util.js';

/** The columns of a publication rule that decide who it reaches. */
export interface AudienceRule {
  targetType: string;
  roleId?: string | null;
  groupId?: string | null;
  userId?: string | null;
}

type AudienceClient = Pick<Prisma.TransactionClient, 'user'>;

/**
 * Users reached by `rules` in `schoolId`, i.e. the readers who see a document with these rules (#110).
 * Mirrors matchingAccessRulesWhere (document-visibility.util.ts) from the user's side: only users with an
 * active assignment in the school count; a role rule needs that role in this school; a class or group rule
 * needs membership or an assignment to that group, which must not be deleted.
 * Document managers are not part of it: they see the document whatever its rules (see documentManagerIds).
 */
export async function audienceOf(db: AudienceClient, schoolId: string, rules: AudienceRule[]): Promise<Set<string>> {
  if (rules.length === 0) return new Set();
  const inSchool = { schoolId, deletedAt: null };
  const ids = (key: 'roleId' | 'groupId' | 'userId') => [
    ...new Set(rules.map((r) => r[key]).filter((id): id is string => !!id)),
  ];
  const roleIds = ids('roleId');
  const groupIds = ids('groupId');
  const userIds = ids('userId');

  // A school rule reaches everyone in the school: no further condition (Prisma does not read OR: [{}] as "all").
  const wholeSchool = rules.some((r) => r.targetType === 'school');
  const reach: Prisma.UserWhereInput[] = [];
  if (roleIds.length) reach.push({ assignments: { some: { ...inSchool, roleId: { in: roleIds } } } });
  if (groupIds.length) {
    const liveGroup = { id: { in: groupIds }, deletedAt: null };
    reach.push({ groupMemberships: { some: { group: liveGroup } } });
    reach.push({ assignments: { some: { deletedAt: null, group: liveGroup } } });
  }
  if (userIds.length) reach.push({ id: { in: userIds } });

  const users = await db.user.findMany({
    where: { assignments: { some: inSchool }, ...(wholeSchool ? {} : { OR: reach }) },
    select: { id: true },
  });
  return new Set(users.map((u) => u.id));
}

/** Among `userIds`, those who manage documents in `schoolId` (or everywhere): they always see its documents. */
export async function documentManagerIds(db: AudienceClient, schoolId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const users = await db.user.findMany({
    where: {
      id: { in: userIds },
      assignments: {
        some: {
          deletedAt: null,
          OR: [
            { role: { scope: 'platform' } },
            {
              schoolId,
              role: { rolePermissions: { some: { permission: { code: { in: [...DOCUMENT_MANAGER_PERMISSION_CODES] } } } } },
            },
          ],
        },
      },
    },
    select: { id: true },
  });
  return new Set(users.map((u) => u.id));
}

/**
 * Readers who lose and gain a document when its rules change from `before` to `after`.
 * Managers are left out: their access never changes with the rules.
 */
export async function audienceChange(
  db: AudienceClient,
  schoolId: string,
  before: AudienceRule[],
  after: AudienceRule[],
): Promise<{ lost: string[]; gained: string[] }> {
  const [was, is] = await Promise.all([audienceOf(db, schoolId, before), audienceOf(db, schoolId, after)]);
  const lost = [...was].filter((id) => !is.has(id));
  const gained = [...is].filter((id) => !was.has(id));
  const managers = await documentManagerIds(db, schoolId, [...lost, ...gained]);
  return { lost: lost.filter((id) => !managers.has(id)), gained: gained.filter((id) => !managers.has(id)) };
}
