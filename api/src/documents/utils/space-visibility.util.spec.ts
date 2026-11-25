import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser, AuthRoleAssignment } from '../../auth/types/authenticated-user.js';
import {
  buildPublishedDocumentWhere,
  buildVisibilityContext,
  buildVisibleSpacesWhere,
} from './space-visibility.util.js';

const ACTIVE_SPACE = { deletedAt: null };

function assignment(over: Partial<AuthRoleAssignment>): AuthRoleAssignment {
  return {
    role: 'STUDENT',
    roleId: 'role-student',
    scope: 'group',
    schoolId: 'S1',
    groupId: null,
    permissions: ['spaces:read'],
    ...over,
  };
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
const schoolAdmin = user([
  assignment({ role: 'SCHOOL_ADMIN', scope: 'school', permissions: ['documents:manage', 'spaces:read'] }),
]);
const student = user([assignment({ groupId: 'G1' })]);
const staff = user([assignment({ role: 'STAFF', roleId: 'role-staff', scope: 'school' })]);
const guest = user([assignment({ role: 'PARENT_GUEST', roleId: 'role-guest', groupId: 'G9' })]);

describe('buildVisibilityContext', () => {
  it('platform scope sees everything', () => {
    expect(buildVisibilityContext(platform)).toEqual({ all: true, manageSchoolIds: [], grants: [] });
  });

  it('documents:manage gives every space of that school', () => {
    expect(buildVisibilityContext(schoolAdmin)).toEqual({ all: false, manageSchoolIds: ['S1'], grants: [] });
  });

  it('other roles with spaces:read become per-school grants backed by matchingAccessRulesWhere', () => {
    const ctx = buildVisibilityContext(student);
    expect(ctx.manageSchoolIds).toEqual([]);
    expect(ctx.grants).toHaveLength(1);
    expect(ctx.grants[0]).toMatchObject({ schoolId: 'S1', isGuest: false });

    const guestCtx = buildVisibilityContext(guest);
    expect(guestCtx.grants).toHaveLength(1);
    expect(guestCtx.grants[0]).toMatchObject({ schoolId: 'S1', isGuest: true });
    expect(JSON.stringify(guestCtx.grants[0].accessWhere)).toContain('"NOT":{"targetType":"school"}');
  });

  it('excludes schools whose assignment lacks spaces:read and documents:manage', () => {
    const mixed = user([
      assignment({ role: 'SCHOOL_ADMIN', schoolId: 'S1', scope: 'school', permissions: ['documents:manage'] }),
      assignment({ role: 'CUSTOM_NO_READ', schoolId: 'S2', scope: 'school', permissions: [] }),
    ]);
    const ctx = buildVisibilityContext(mixed);
    expect(ctx.manageSchoolIds).toEqual(['S1']);
    expect(ctx.grants).toEqual([]);
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

  it('requires an active, available document and matchingAccessRulesWhere of the same school', () => {
    const grants = buildVisibilityContext(student).grants;
    const where = buildPublishedDocumentWhere(grants);
    expect(where).toEqual({
      AND: [
        { deletedAt: null, space: ACTIVE_SPACE },
        { versions: { some: { status: 'available' } } },
        {
          OR: [
            {
              space: { schoolId: 'S1' },
              access: { some: grants[0].accessWhere },
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(grants[0].accessWhere)).toContain('"targetType":"user","userId":"u1"');
  });

  it('a guest needs an explicit share (role, class/group, or user) and never matches school-wide rules', () => {
    const guestGrants = buildVisibilityContext(guest).grants;
    expect(JSON.stringify(guestGrants[0].accessWhere)).toContain('"NOT":{"targetType":"school"}');
    const nonGuestGrants = buildVisibilityContext(student).grants;
    expect(JSON.stringify(nonGuestGrants[0].accessWhere)).not.toContain('"NOT"');
  });

  it('one OR branch per school, so a row of school A never opens a space of school B', () => {
    const dual = user([
      assignment({ schoolId: 'A', role: 'STAFF' }),
      assignment({ schoolId: 'B', role: 'PARENT_GUEST' }),
    ]);
    const where = buildPublishedDocumentWhere(buildVisibilityContext(dual).grants);
    const branches = (where.AND as { OR?: { space: { schoolId: string }; access: { some: unknown } }[] }[])[2].OR!;
    expect(branches.map((b) => b.space.schoolId)).toEqual(['A', 'B']);
    expect(JSON.stringify(branches[0].access.some)).not.toContain('"NOT"');
    expect(JSON.stringify(branches[1].access.some)).toContain('"NOT":{"targetType":"school"}');
  });
});

describe('buildVisibleSpacesWhere', () => {
  it('platform: only the active filter', () => {
    expect(buildVisibleSpacesWhere(buildVisibilityContext(platform))).toEqual(ACTIVE_SPACE);
  });

  it('platform: schoolId and search narrow the result', () => {
    expect(buildVisibleSpacesWhere(buildVisibilityContext(platform), { schoolId: 'S2', search: 'math' })).toEqual({
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
      const ctx = buildVisibilityContext(u);
      const where = buildVisibleSpacesWhere(ctx);
      const [tiers] = where.AND as { OR: { documents: { some: unknown } }[] }[];
      expect(tiers.OR).toHaveLength(1);
      expect(tiers.OR[0].documents.some).toEqual(buildPublishedDocumentWhere(ctx.grants));
    }
  });

  it('a user with no assignment sees nothing', () => {
    expect(buildVisibleSpacesWhere(buildVisibilityContext(user([])))).toEqual({
      ...ACTIVE_SPACE,
      AND: [{ id: { in: [] } }],
    });
  });

  it('empty search is ignored', () => {
    expect(buildVisibleSpacesWhere(buildVisibilityContext(platform), { search: '' })).toEqual(ACTIVE_SPACE);
  });
});
