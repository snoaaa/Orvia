import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** GET /groups, GET /groups/:id and PATCH /groups/:id (#34): scoping, filters, pagination, updates. */
describe('Group list, view and update (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  // Every group of this suite has the tag in its name, so `search=tag` isolates them from other data.
  const tag = `G${stamp}`;
  const schools = { A: '', B: '', Off: '' };
  const groups: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let platformAdminId: string;

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const list = async (as: string, query: Record<string, string | number> = {}) =>
    http()
      .get('/groups')
      .query({ search: tag, limit: 100, ...query })
      .set('Authorization', await bearer(as));
  const view = async (as: string, id: string) =>
    http()
      .get(`/groups/${id}`)
      .set('Authorization', await bearer(as));
  const update = async (as: string, id: string, body: object) =>
    http()
      .patch(`/groups/${id}`)
      .set('Authorization', await bearer(as))
      .send(body);
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  const names = (body: { data: { name: string }[] }) => body.data.map((g) => g.name.replace(`${tag} `, ''));

  async function user(key: string, roleName: string) {
    const created = await prisma.user.create({
      data: { email: `e2e-groupsmanage-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status: 'ACTIVE' },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await prisma.userAssignment.create({ data: { userId: created.id, schoolId: schools.A, roleId: role.id } });
    ids[key] = created.id;
  }

  async function group(key: string, school: keyof typeof schools, type: string, createdAt: Date) {
    groups[key] = (
      await prisma.group.create({ data: { schoolId: schools[school], name: `${tag} ${key}`, type, createdAt } })
    ).id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    schools.A = (await prisma.school.create({ data: { name: `Test E2E GroupsManage School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E GroupsManage School B ${stamp}` } })).id;
    schools.Off = (
      await prisma.school.create({ data: { name: `Test E2E GroupsManage School Off ${stamp}`, status: 'deactivated' } })
    ).id;

    // Created oldest first, so the default sort (newest first) is Delta, Charlie, Bravo, Alpha.
    const t0 = Date.now() - 60_000;
    await group('Alpha', 'A', 'class', new Date(t0));
    await group('Bravo', 'A', 'team', new Date(t0 + 1000));
    await group('Charlie', 'A', 'department', new Date(t0 + 2000));
    await group('Delta', 'B', 'class', new Date(t0 + 3000));
    await group('Frozen', 'Off', 'class', new Date(t0 - 1000));

    // Content managers got groups:read in #34; grant it here too so databases with an older seed pass.
    const manager = await prisma.role.findUniqueOrThrow({ where: { name: 'CONTENT_MANAGER' } });
    const groupsRead = await prisma.permission.upsert({
      where: { code: 'groups:read' },
      update: {},
      create: { code: 'groups:read', description: 'View group details and roster' },
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: manager.id, permissionId: groupsRead.id } },
      update: {},
      create: { roleId: manager.id, permissionId: groupsRead.id },
    });

    await user('AdminA', 'SCHOOL_ADMIN');
    await user('ManagerA', 'CONTENT_MANAGER');
    await user('StudentA', 'STUDENT');
    for (const key of ['AdminA', 'ManagerA', 'StudentA']) {
      await prisma.groupMember.create({ data: { groupId: groups.Alpha, userId: ids[key] } });
    }

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@school.edu` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E GroupsManage School' } } });
    await app.close();
  });

  describe('access', () => {
    it('requires a token', async () => {
      await http().get('/groups').expect(401);
      await http().get(`/groups/${groups.Alpha}`).expect(401);
      await http().patch(`/groups/${groups.Alpha}`).send({ name: 'X' }).expect(401);
    });

    it('a student cannot list or view groups', async () => {
      check(await list(ids.StudentA), 403);
      check(await view(ids.StudentA, groups.Alpha), 403);
    });

    it('a content manager can list and view the groups of their school, but not update them', async () => {
      const res = check(await list(ids.ManagerA, { sortBy: 'name' }), 200);
      expect(names(res.body)).toEqual(['Alpha', 'Bravo', 'Charlie']);
      check(await view(ids.ManagerA, groups.Alpha), 200);
      check(await update(ids.ManagerA, groups.Alpha, { name: `${tag} Hacked` }), 403);
    });
  });

  describe('list', () => {
    it('a platform admin sees every school, newest first by default', async () => {
      const res = check(await list(platformAdminId), 200);
      expect(names(res.body)).toEqual(['Delta', 'Charlie', 'Bravo', 'Alpha', 'Frozen']);
    });

    it('a school admin only sees the groups of their school', async () => {
      const res = check(await list(ids.AdminA), 200);
      expect(names(res.body)).toEqual(['Charlie', 'Bravo', 'Alpha']);
    });

    it('a school admin cannot filter on another school', async () => {
      check(await list(ids.AdminA, { schoolId: schools.B }), 403);
    });

    it('filters by school and type', async () => {
      expect(names(check(await list(platformAdminId, { schoolId: schools.B }), 200).body)).toEqual(['Delta']);
      const byType = check(await list(platformAdminId, { type: 'CLASS', sortBy: 'name' }), 200);
      expect(names(byType.body)).toEqual(['Alpha', 'Delta', 'Frozen']);
    });

    it('searches part of the name, ignoring case', async () => {
      const res = check(await list(platformAdminId, { search: `${tag} ALP`.toLowerCase() }), 200);
      expect(names(res.body)).toEqual(['Alpha']);
    });

    it('carries the school name and the member count', async () => {
      const res = check(await list(platformAdminId, { search: `${tag} Alpha` }), 200);
      expect(res.body.data[0]).toMatchObject({
        id: groups.Alpha,
        schoolId: schools.A,
        schoolName: `Test E2E GroupsManage School A ${stamp}`,
        type: 'class',
        memberCount: 3,
      });
    });

    it('sorts A-Z by default for text columns, and pages without overlap', async () => {
      const first = check(await list(platformAdminId, { sortBy: 'name', limit: 2, page: 1 }), 200);
      const third = check(await list(platformAdminId, { sortBy: 'name', limit: 2, page: 3 }), 200);
      expect(first.body).toMatchObject({ total: 5, page: 1, limit: 2, totalPages: 3 });
      expect(names(first.body)).toEqual(['Alpha', 'Bravo']);
      expect(names(third.body)).toEqual(['Frozen']);
      const desc = check(await list(platformAdminId, { sortBy: 'name', sortOrder: 'desc' }), 200);
      expect(names(desc.body)).toEqual(['Frozen', 'Delta', 'Charlie', 'Bravo', 'Alpha']);
    });

    it.each([
      ['an unknown type', { type: 'club' }],
      ['an invalid schoolId', { schoolId: 'abc' }],
      ['a limit over 100', { limit: 101 }],
      ['page 0', { page: 0 }],
      ['an unknown sort field', { sortBy: 'schoolId' }],
    ])('rejects %s', async (_label, query) => {
      check(await list(platformAdminId, query), 400);
    });
  });

  describe('view', () => {
    it('returns the group with its member count', async () => {
      const res = check(await view(ids.AdminA, groups.Alpha), 200);
      expect(res.body).toMatchObject({ id: groups.Alpha, name: `${tag} Alpha`, schoolId: schools.A, memberCount: 3 });
    });

    it('a school admin gets 403 for a group of another school', async () => {
      check(await view(ids.AdminA, groups.Delta), 403);
    });

    it('answers 400 for an invalid id and 404 for an unknown group', async () => {
      check(await view(platformAdminId, 'abc'), 400);
      check(await view(platformAdminId, '00000000-0000-4000-8000-000000000000'), 404);
    });
  });

  describe('update', () => {
    it('a school admin renames a group of their school, and updated_at changes', async () => {
      const past = new Date(Date.now() - 60_000);
      await prisma.group.update({ where: { id: groups.Bravo }, data: { updatedAt: past } });

      const res = check(await update(ids.AdminA, groups.Bravo, { name: `  ${tag} Bravo 2  `, type: 'class' }), 200);
      expect(res.body).toMatchObject({ id: groups.Bravo, name: `${tag} Bravo 2`, type: 'class', memberCount: 0 });
      const row = await prisma.group.findUniqueOrThrow({ where: { id: groups.Bravo } });
      expect(row.updatedAt.getTime()).toBeGreaterThan(past.getTime());
    });

    it('does not write when nothing changes', async () => {
      const past = new Date(Date.now() - 60_000);
      await prisma.group.update({ where: { id: groups.Charlie }, data: { updatedAt: past } });
      check(await update(ids.AdminA, groups.Charlie, { name: `${tag} Charlie`, type: 'department' }), 200);
      const row = await prisma.group.findUniqueOrThrow({ where: { id: groups.Charlie } });
      expect(row.updatedAt.getTime()).toBe(past.getTime());
    });

    it('a school admin cannot update a group of another school', async () => {
      check(await update(ids.AdminA, groups.Delta, { name: `${tag} Hacked` }), 403);
    });

    it('a platform admin can update a group of any school', async () => {
      check(await update(platformAdminId, groups.Delta, { type: 'team' }), 200);
    });

    it('rejects a name already used in the same school, ignoring case', async () => {
      const res = check(await update(ids.AdminA, groups.Charlie, { name: `${tag} alpha` }), 409);
      expect(res.body.message).toContain('already exists');
    });

    it('allows a name used in another school', async () => {
      check(await update(platformAdminId, groups.Delta, { name: `${tag} Alpha` }), 200);
    });

    it('rejects a group of a deactivated school', async () => {
      check(await update(platformAdminId, groups.Frozen, { name: `${tag} Thawed` }), 400);
    });

    it.each([
      ['an empty body', {}],
      ['a blank name', { name: '   ' }],
      ['an unknown type', { type: 'club' }],
      ['a school change', { schoolId: '00000000-0000-4000-8000-000000000000' }],
    ])('rejects %s', async (_label, body) => {
      check(await update(platformAdminId, groups.Alpha, body), 400);
    });

    it('answers 400 for an invalid id and 404 for an unknown group', async () => {
      check(await update(platformAdminId, 'abc', { name: 'X' }), 400);
      check(await update(platformAdminId, '00000000-0000-4000-8000-000000000000', { name: 'X' }), 404);
    });
  });
});
