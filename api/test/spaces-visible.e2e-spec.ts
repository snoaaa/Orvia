import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** GET /documents/spaces and /documents/spaces/:id (#99, Section 4.7): exactly the spaces each role may see. */
describe('Visible spaces (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const prefix = `Vis${stamp}`;
  const schools = { A: '', B: '' };
  const ids: Record<string, string> = {};
  const spaces: Record<string, string> = {}; // label -> space id
  const labelOf = new Map<string, string>(); // space id -> label
  const roleIds: Record<string, string> = {};
  const groups = { G1: '', G9: '' };
  let platformAdminId: string;
  let counter = 0;

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const get = async (as: string, path: string) => http().get(path).set('Authorization', await bearer(as));
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  /** Labels of the test spaces the user sees (the search keeps other data of the database out), sorted. */
  const seen = async (as: string, extra = ''): Promise<string[]> => {
    const res = check(await get(as, `/documents/spaces?limit=100&search=${prefix}${extra}`), 200);
    return (res.body.data as { id: string }[]).map((s) => labelOf.get(s.id)!).sort();
  };

  type Access = { school?: 'A' | 'B' | null; role?: string; group?: keyof typeof groups };
  /** A space in school `school`; optionally with a document (status of its version) and its access rows. */
  async function space(
    label: string,
    school: 'A' | 'B',
    opts: { doc?: { status?: string; deleted?: boolean; access?: Access[] }; deleted?: boolean } = {},
  ) {
    const created = await prisma.space.create({
      data: { schoolId: schools[school], name: `${prefix} ${label}`, deletedAt: opts.deleted ? new Date() : null },
    });
    spaces[label] = created.id;
    labelOf.set(created.id, label);
    if (opts.doc) {
      await prisma.document.create({
        data: {
          spaceId: created.id,
          title: `doc ${label}`,
          deletedAt: opts.doc.deleted ? new Date() : null,
          versions: {
            create: {
              versionNo: 1,
              storageKey: `e2e/${stamp}/${++counter}.pdf`,
              mimeType: 'application/pdf',
              checksum: `sum-${stamp}-${counter}`,
              status: opts.doc.status ?? 'indexed',
            },
          },
          access: {
            create: (opts.doc.access ?? []).map((a) => ({
              schoolId: a.school === null ? null : schools[a.school ?? school],
              roleId: a.role ? roleIds[a.role] : null,
              groupId: a.group ? groups[a.group] : null,
            })),
          },
        },
      });
    }
  }

  type Assignment = { school: 'A' | 'B'; role: string; group?: keyof typeof groups };
  async function user(key: string, assignments: Assignment[], member?: keyof typeof groups) {
    const created = await prisma.user.create({
      data: { email: `e2e-vis-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status: 'ACTIVE' },
    });
    for (const a of assignments) {
      await prisma.userAssignment.create({
        data: { userId: created.id, schoolId: schools[a.school], roleId: roleIds[a.role], groupId: a.group ? groups[a.group] : null },
      });
    }
    if (member) await prisma.groupMember.create({ data: { userId: created.id, groupId: groups[member] } });
    ids[key] = created.id;
  }

  const ALL_A = [
    'deletedDoc', 'empty', 'groupG1', 'groupGuest', 'noAccess', 'nullSchoolRow', 'otherSchoolRow', 'pending',
    'roleGuest', 'roleStaff', 'schoolWide',
  ].sort();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    for (const name of ['SCHOOL_ADMIN', 'CONTENT_MANAGER', 'STUDENT', 'PARENT_GUEST']) {
      roleIds[name] = (await prisma.role.findUniqueOrThrow({ where: { name } })).id;
    }
    // Test roles, so the spec does not depend on the permissions the seeded STAFF role has in this database.
    const makeRole = async (key: string, codes: string[]) => {
      const role = await prisma.role.create({ data: { name: `E2E Vis ${key} ${stamp}`, scope: 'school' } });
      const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
      expect(permissions).toHaveLength(codes.length);
      await prisma.rolePermission.createMany({ data: permissions.map((perm) => ({ roleId: role.id, permissionId: perm.id })) });
      roleIds[key] = role.id;
    };
    await makeRole('STAFF', ['spaces:read', 'documents:read']);
    await makeRole('STAFF_DOCS', ['spaces:read', 'documents:read', 'documents:update']);
    schools.A = (await prisma.school.create({ data: { name: `Test E2E Vis School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E Vis School B ${stamp}` } })).id;
    groups.G1 = (await prisma.group.create({ data: { schoolId: schools.A, name: `G1 ${stamp}` } })).id;
    groups.G9 = (await prisma.group.create({ data: { schoolId: schools.A, name: `G9 ${stamp}` } })).id;

    // Spaces of school A, one per way a document can (not) be published.
    await space('empty', 'A');
    await space('schoolWide', 'A', { doc: { access: [{}] } });
    await space('roleStaff', 'A', { doc: { access: [{ role: 'STAFF' }] } });
    await space('groupG1', 'A', { doc: { access: [{ group: 'G1' }] } });
    await space('roleGuest', 'A', { doc: { access: [{ role: 'PARENT_GUEST' }] } });
    await space('groupGuest', 'A', { doc: { access: [{ group: 'G9' }] } });
    await space('pending', 'A', { doc: { status: 'pending', access: [{}] } });
    await space('noAccess', 'A', { doc: { access: [] } });
    await space('deletedDoc', 'A', { doc: { deleted: true, access: [{}] } });
    await space('nullSchoolRow', 'A', { doc: { access: [{ school: null, role: 'STAFF' }] } });
    await space('otherSchoolRow', 'A', { doc: { access: [{ school: 'B' }] } });
    await space('deletedSpace', 'A', { deleted: true, doc: { access: [{}] } });
    await space('schoolB', 'B', { doc: { access: [{}] } });

    await user('AdminA', [{ school: 'A', role: 'SCHOOL_ADMIN' }]);
    await user('ManagerA', [{ school: 'A', role: 'CONTENT_MANAGER' }]);
    await user('StaffA', [{ school: 'A', role: 'STAFF' }]);
    await user('StudentG1', [{ school: 'A', role: 'STUDENT', group: 'G1' }]);
    await user('StudentMember', [{ school: 'A', role: 'STUDENT' }], 'G1'); // group through group_members
    await user('StudentPlain', [{ school: 'A', role: 'STUDENT' }]);
    await user('GuestG9', [{ school: 'A', role: 'PARENT_GUEST', group: 'G9' }]);
    await user('GuestPlain', [{ school: 'A', role: 'PARENT_GUEST' }]);
    await user('ManagerAStaffB', [{ school: 'A', role: 'CONTENT_MANAGER' }, { school: 'B', role: 'STAFF' }]);
    await user('StaffDocsA', [{ school: 'A', role: 'STAFF_DOCS' }]);

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({ where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' } })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    // Deleting the schools cascades to their groups, spaces, documents, versions and access rows.
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E Vis School' } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: 'E2E Vis ' } } });
    await app.close();
  });

  describe('GET /documents/spaces: exactly the scope of each role', () => {
    it('requires a token', async () => {
      await http().get('/documents/spaces').expect(401);
    });

    it('platform admin: every active space, filterable by school', async () => {
      expect(await seen(platformAdminId)).toEqual([...ALL_A, 'schoolB'].sort());
      expect(await seen(platformAdminId, `&schoolId=${schools.A}`)).toEqual(ALL_A);
      expect(await seen(platformAdminId, `&schoolId=${schools.B}`)).toEqual(['schoolB']);
    });

    it.each(['AdminA', 'ManagerA'])('%s (documents:manage): every active space of their school, even empty ones', async (key) => {
      expect(await seen(ids[key])).toEqual(ALL_A);
    });

    it('a school admin cannot widen the scope with schoolId (empty list, no leak)', async () => {
      expect(await seen(ids.AdminA, `&schoolId=${schools.B}`)).toEqual([]);
      expect(await seen(ids.AdminA, `&schoolId=${schools.A}`)).toEqual(ALL_A);
    });

    it('staff: spaces with a document published to the school or to the STAFF role', async () => {
      expect(await seen(ids.StaffA)).toEqual(['roleStaff', 'schoolWide']);
    });

    it('student with the group on the assignment: school-wide and own group', async () => {
      expect(await seen(ids.StudentG1)).toEqual(['groupG1', 'schoolWide']);
    });

    it('student in the group through group_members: same as a member by assignment', async () => {
      expect(await seen(ids.StudentMember)).toEqual(['groupG1', 'schoolWide']);
    });

    it('student without group: school-wide only', async () => {
      expect(await seen(ids.StudentPlain)).toEqual(['schoolWide']);
    });

    it('guest: only what is explicitly shared with the guest role or their group, never school-wide', async () => {
      expect(await seen(ids.GuestG9)).toEqual(['groupGuest', 'roleGuest']);
      expect(await seen(ids.GuestPlain)).toEqual(['roleGuest']);
    });

    it('staff holding a document-management right (documents:update) see every space of their school (#97/#98 rule)', async () => {
      expect(await seen(ids.StaffDocsA)).toEqual(ALL_A);
    });

    it('a user with no assignment has no spaces:read and is refused', async () => {
      const nobody = await prisma.user.create({ data: { email: `e2e-vis-nobody-${stamp}@school.edu`, fullName: 'Nobody', status: 'ACTIVE' } });
      check(await get(nobody.id, `/documents/spaces?search=${prefix}`), 403);
    });

    it('manager in A and staff in B: every space of A plus what is published to them in B', async () => {
      expect(await seen(ids.ManagerAStaffB)).toEqual([...ALL_A, 'schoolB'].sort());
    });

    it('never returns an unprocessed document, a deleted document or space, a row of another school or no school', async () => {
      for (const key of ['StaffA', 'StudentG1', 'StudentPlain', 'GuestG9', 'GuestPlain']) {
        const list = await seen(ids[key]);
        for (const hidden of ['pending', 'deletedDoc', 'deletedSpace', 'noAccess', 'otherSchoolRow', 'nullSchoolRow', 'empty', 'schoolB']) {
          expect(list).not.toContain(hidden);
        }
      }
    });

    it('a document that becomes indexed makes its space visible; a deleted document hides it again', async () => {
      const doc = await prisma.document.findFirstOrThrow({ where: { spaceId: spaces.pending } });
      expect(await seen(ids.StudentPlain)).not.toContain('pending');
      await prisma.documentVersion.updateMany({ where: { documentId: doc.id }, data: { status: 'indexed' } });
      expect(await seen(ids.StudentPlain)).toContain('pending');
      await prisma.document.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
      expect(await seen(ids.StudentPlain)).not.toContain('pending');
    });

    it('a removed assignment or a deleted group takes the access away immediately', async () => {
      await prisma.group.update({ where: { id: groups.G1 }, data: { deletedAt: new Date() } });
      expect(await seen(ids.StudentG1)).toEqual(['schoolWide']);
      expect(await seen(ids.StudentMember)).toEqual(['schoolWide']);
      await prisma.group.update({ where: { id: groups.G1 }, data: { deletedAt: null } });
      expect(await seen(ids.StudentG1)).toEqual(['groupG1', 'schoolWide']);

      await prisma.userAssignment.updateMany({ where: { userId: ids.StudentPlain }, data: { deletedAt: new Date() } });
      // No active assignment left: no spaces:read either, so the request is refused outright.
      check(await get(ids.StudentPlain, `/documents/spaces?search=${prefix}`), 403);
      await prisma.userAssignment.updateMany({ where: { userId: ids.StudentPlain }, data: { deletedAt: null } });
      expect(await seen(ids.StudentPlain)).toEqual(['schoolWide']);
    });
  });

  describe('search and pagination', () => {
    it('search by name is case-insensitive and partial', async () => {
      expect(await seen(ids.AdminA, '')).toContain('empty');
      const res = check(await get(ids.AdminA, `/documents/spaces?search=${prefix.toUpperCase()}%20ROLE`), 200);
      expect((res.body.data as { id: string }[]).map((s) => labelOf.get(s.id)).sort((a, b) => (a ?? '').localeCompare(b ?? ''))).toEqual(['roleGuest', 'roleStaff']);
    });

    it('search never widens the scope', async () => {
      const res = check(await get(ids.StudentPlain, `/documents/spaces?search=${prefix}%20roleStaff`), 200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('keeps the pagination contract, alphabetical', async () => {
      const p1 = check(await get(ids.AdminA, `/documents/spaces?search=${prefix}&limit=4&page=1`), 200).body;
      const p3 = check(await get(ids.AdminA, `/documents/spaces?search=${prefix}&limit=4&page=3`), 200).body;
      expect(p1).toMatchObject({ total: ALL_A.length, page: 1, limit: 4, totalPages: 3 });
      expect(p1.data).toHaveLength(4);
      expect(p3.data).toHaveLength(ALL_A.length - 8);
      const names = (p1.data as { name: string }[]).map((s) => s.name);
      expect(names).toEqual([...names].sort());
    });

    it('rejects a schoolId that is not a UUID and an unknown query field', async () => {
      check(await get(ids.AdminA, '/documents/spaces?schoolId=nope'), 400);
      check(await get(ids.AdminA, '/documents/spaces?foo=1'), 400);
    });
  });

  describe('GET /documents/spaces/:id: same rule, 404 outside it', () => {
    it('answers 200 for a visible space and 404 for the others (not 403)', async () => {
      check(await get(ids.StudentG1, `/documents/spaces/${spaces.schoolWide}`), 200);
      check(await get(ids.StudentG1, `/documents/spaces/${spaces.groupG1}`), 200);
      check(await get(ids.StudentG1, `/documents/spaces/${spaces.empty}`), 404);
      check(await get(ids.StudentG1, `/documents/spaces/${spaces.roleStaff}`), 404);
      check(await get(ids.GuestPlain, `/documents/spaces/${spaces.schoolWide}`), 404);
      check(await get(ids.GuestPlain, `/documents/spaces/${spaces.roleGuest}`), 200);
      check(await get(ids.StaffA, `/documents/spaces/${spaces.roleStaff}`), 200);
    });

    it('managers open every space of their school, not other schools', async () => {
      check(await get(ids.AdminA, `/documents/spaces/${spaces.empty}`), 200);
      check(await get(ids.AdminA, `/documents/spaces/${spaces.schoolB}`), 404);
      check(await get(ids.AdminA, `/documents/spaces/${spaces.deletedSpace}`), 404);
    });

    it('platform admin opens any active space', async () => {
      check(await get(platformAdminId, `/documents/spaces/${spaces.schoolB}`), 200);
      check(await get(platformAdminId, `/documents/spaces/${spaces.empty}`), 200);
      check(await get(platformAdminId, `/documents/spaces/${spaces.deletedSpace}`), 404);
    });
  });
});
