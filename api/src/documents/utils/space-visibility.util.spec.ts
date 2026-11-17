import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser, AuthRoleAssignment } from '../../auth/types/authenticated-user.js';
import {
  buildPublishedDocumentWhere,
  buildVisibilityContext,
  buildVisibleSpacesWhere,
  needsGroups,
} from './space-visibility.util.js';

const ACTIVE_SPACE = { deletedAt: null };

function assignment(over: Partial<AuthRoleAssignment>): AuthRoleAssignment {
  return { role: 'STUDENT', roleId: 'role-student', scope: 'group', schoolId: 'S1', groupId: null, permissions: ['spaces:read'], ...over };
}

function user(assignments: AuthRoleAssignment[]): AuthenticatedUser {
  return {
    id: 'u1',
    email: 'u@x.test',
    fullName: 'U',
    status: 'ACTIVE',
    assignments,
    permissions: [],
    schoolIds: [...new Set(assignments.map((a) => a.schoolId))],
    isPlatformAdmin: assignments.some((a) => a.scope === 'platform'),
    role: assignments[0]?.role ?? null,
    schoolId: assignments[0]?.schoolId ?? null,
    sessionId: null,
  };
}

const platform = user([assignment({ role: 'PLATFORM_ADMIN', scope: 'platform', permissions: ['documents:manage'] })]);
const schoolAdmin = user([assignment({ role: 'SCHOOL_ADMIN', scope: 'school', permissions: ['documents:manage', 'spaces:read'] })]);
const student = user([assignment({ groupId: 'G1' })]);
const staff = user([assignment({ role: 'STAFF', roleId: 'role-staff', scope: 'school' })]);
const guest = user([assignment({ role: 'PARENT_GUEST', roleId: 'role-guest', groupId: 'G9' })]);

describe('buildVisibilityContext', () => {
  it('platform scope sees everything', () => {
    expect(buildVisibilityContext(platform)).toEqual({ all: true, manageSchoolIds: [], grants: [] });
    expect(needsGroups(platform)).toBe(false);
  });

  it('documents:manage gives every space of that school and needs no group lookup', () => {
    expect(buildVisibilityContext(schoolAdmin)).toEqual({ all: false, manageSchoolIds: ['S1'], grants: [] });
    expect(needsGroups(schoolAdmin)).toBe(false);
  });

  it('other roles become grants; the guest is flagged; groups come from the loaded non-deleted groups', () => {
    expect(needsGroups(student)).toBe(true);
    expect(buildVisibilityContext(student, new Map([['S1', ['G2', 'G1']]]))).toEqual({
      all: false,
      manageSchoolIds: [],
      grants: [{ schoolId: 'S1', roleId: 'role-student', isGuest: false, groupIds: ['G2', 'G1'] }],
    });
    expect(buildVisibilityContext(guest, new Map([['S1', ['G9']]])).grants).toEqual([
      { schoolId: 'S1', roleId: 'role-guest', isGuest: true, groupIds: ['G9'] },
    ]);
    // No group loaded (deleted group): the assignment's own group id does not count by itself.
    expect(buildVisibilityContext(guest).grants[0].groupIds).toEqual([]);
  });

  it('mixes tiers across schools: manager in S1, student in S2', () => {
    const mixed = user([
      assignment({ role: 'SCHOOL_ADMIN', scope: 'school', permissions: ['documents:manage'] }),
      assignment({ schoolId: 'S2' }),
    ]);
    const ctx = buildVisibilityContext(mixed);
    expect(ctx.manageSchoolIds).toEqual(['S1']);
    expect(ctx.grants.map((g) => g.schoolId)).toEqual(['S2']);
  });
});

describe('buildPublishedDocumentWhere', () => {
  it('matches nothing without a grant', () => {
    expect(buildPublishedDocumentWhere([])).toEqual({ id: { in: [] } });
  });

  it('requires an active, indexed document and an access row of the same school', () => {
    const where = buildPublishedDocumentWhere([{ schoolId: 'S1', roleId: 'R1', isGuest: false, groupIds: ['G1'] }]);
    expect(where).toEqual({
      AND: [
        { deletedAt: null, space: ACTIVE_SPACE },
        { versions: { some: { status: 'indexed' } } },
        {
          OR: [
            {
              space: { schoolId: 'S1' },
              access: {
                some: {
                  schoolId: 'S1',
                  AND: [{ OR: [{ roleId: null }, { roleId: 'R1' }] }, { OR: [{ groupId: null }, { groupId: { in: ['G1'] } }] }],
                },
              },
            },
          ],
        },
      ],
    });
  });

  it('without groups or role id only the null wildcards remain', () => {
    const where = buildPublishedDocumentWhere([{ schoolId: 'S1', isGuest: false, groupIds: [] }]);
    const row = JSON.stringify(where);
    expect(row).toContain('"AND":[{"OR":[{"roleId":null}]},{"OR":[{"groupId":null}]}]');
  });

  it('a guest needs an explicit row: role_id or group_id set', () => {
    const where = buildPublishedDocumentWhere([{ schoolId: 'S1', roleId: 'R', isGuest: true, groupIds: [] }]);
    expect(JSON.stringify(where)).toContain('"NOT":{"roleId":null,"groupId":null}');
    const nonGuest = buildPublishedDocumentWhere([{ schoolId: 'S1', roleId: 'R', isGuest: false, groupIds: [] }]);
    expect(JSON.stringify(nonGuest)).not.toContain('"NOT"');
  });

  it('one OR branch per assignment, so a row of school A never opens a space of school B', () => {
    const where = buildPublishedDocumentWhere([
      { schoolId: 'A', roleId: 'R', isGuest: false, groupIds: [] },
      { schoolId: 'B', roleId: 'R', isGuest: false, groupIds: [] },
    ]);
    const branches = (where.AND as { OR?: { space: { schoolId: string }; access: { some: { schoolId: string } } }[] }[])[2].OR!;
    expect(branches.map((b) => [b.space.schoolId, b.access.some.schoolId])).toEqual([
      ['A', 'A'],
      ['B', 'B'],
    ]);
  });
});

describe('buildVisibleSpacesWhere', () => {
  it('platform: only the active filter', () => {
    expect(buildVisibleSpacesWhere(buildVisibilityContext(platform))).toEqual(ACTIVE_SPACE);
  });

  it('platform: schoolId and search narrow the result', () => {
    expect(buildVisibleSpacesWhere(buildVisibilityContext(platform), { schoolId: 'S2', search: ' math ' })).toEqual({
      ...ACTIVE_SPACE,
      AND: [{ schoolId: 'S2' }, { name: { contains: 'math' } }],
    });
  });

  it('manager: every space of the school, nothing about documents', () => {
    expect(buildVisibleSpacesWhere(buildVisibilityContext(schoolAdmin))).toEqual({
      ...ACTIVE_SPACE,
      AND: [{ OR: [{ schoolId: { in: ['S1'] } }] }],
    });
  });

  it('a manager asking for a school outside their scope keeps both conditions (empty result, no leak)', () => {
    const where = buildVisibleSpacesWhere(buildVisibilityContext(schoolAdmin), { schoolId: 'OTHER' });
    expect(where.AND).toEqual([{ OR: [{ schoolId: { in: ['S1'] } }] }, { schoolId: 'OTHER' }]);
  });

  it('staff / student / guest: spaces holding a published document', () => {
    for (const u of [staff, student, guest]) {
      const where = buildVisibleSpacesWhere(buildVisibilityContext(u));
      const [tiers] = where.AND as { OR: { documents: { some: unknown } }[] }[];
      expect(tiers.OR).toHaveLength(1);
      expect(tiers.OR[0].documents.some).toEqual(
        buildPublishedDocumentWhere(buildVisibilityContext(u).grants),
      );
    }
  });

  it('a user with no assignment sees nothing', () => {
    expect(buildVisibleSpacesWhere(buildVisibilityContext(user([])))).toEqual({
      ...ACTIVE_SPACE,
      AND: [{ id: { in: [] } }],
    });
  });

  it('blank search is ignored', () => {
    expect(buildVisibleSpacesWhere(buildVisibilityContext(platform), { search: '   ' })).toEqual(ACTIVE_SPACE);
  });
});
