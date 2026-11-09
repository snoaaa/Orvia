import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * POST /assignments and GET /assignments/assignable-roles (#47), plus PATCH /identity/users/:id/role,
 * which now uses the same role-level check.
 */
describe('Assignments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const schools = { A: '', B: '', Off: '' };
  const groups = { A1: '', B1: '' };
  const ids: Record<string, string> = {};
  let platformAdminId: string;

  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const assign = async (as: string, body: object) =>
    request(app.getHttpServer()).post('/assignments').set('Authorization', await bearer(as)).send(body);
  const assignable = async (as: string, schoolId?: string) =>
    request(app.getHttpServer())
      .get('/assignments/assignable-roles')
      .query(schoolId ? { schoolId } : {})
      .set('Authorization', await bearer(as));
  const patchRole = async (as: string, id: string, body: object) =>
    request(app.getHttpServer()).patch(`/identity/users/${id}/role`).set('Authorization', await bearer(as)).send(body);
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  const assignmentsOf = (userId: string) => prisma.userAssignment.findMany({ where: { userId } });

  /** A user with an optional role in school A. */
  async function user(key: string, roleName?: string) {
    const created = await prisma.user.create({
      data: { email: `e2e-assign-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status: 'ACTIVE' },
    });
    if (roleName) {
      const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
      await prisma.userAssignment.create({ data: { userId: created.id, schoolId: schools.A, roleId: role.id } });
    }
    ids[key] = created.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    schools.A = (await prisma.school.create({ data: { name: `Test E2E Assign School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E Assign School B ${stamp}` } })).id;
    schools.Off = (
      await prisma.school.create({ data: { name: `Test E2E Assign School Off ${stamp}`, status: 'deactivated' } })
    ).id;
    groups.A1 = (await prisma.group.create({ data: { schoolId: schools.A, name: 'A1' } })).id;
    groups.B1 = (await prisma.group.create({ data: { schoolId: schools.B, name: 'B1' } })).id;

    await user('AdminA', 'SCHOOL_ADMIN');
    await user('ManagerA', 'CONTENT_MANAGER');
    for (const key of ['New1', 'New2', 'New3', 'New4', 'Race', 'Patch1', 'Patch2']) await user(key);

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@school.edu` } } });
    await prisma.school.deleteMany({ where: { name: { contains: `Test E2E Assign School` } } });
    await app.close();
  });

  describe('access', () => {
    it('requires a token', async () => {
      await request(app.getHttpServer()).post('/assignments').send({}).expect(401);
      await request(app.getHttpServer()).get('/assignments/assignable-roles').expect(401);
    });

    it('rejects a content manager (no users:assign_role)', async () => {
      check(await assign(ids.ManagerA, { userId: ids.New1, schoolId: schools.A, role: 'STUDENT' }), 403);
      check(await assignable(ids.ManagerA), 403);
      expect(await assignmentsOf(ids.New1)).toHaveLength(0);
    });

    it('a school admin cannot assign in another school', async () => {
      check(await assign(ids.AdminA, { userId: ids.New1, schoolId: schools.B, role: 'STUDENT' }), 403);
      expect(await assignmentsOf(ids.New1)).toHaveLength(0);
    });
  });

  describe('POST /assignments', () => {
    it('a school admin assigns a user to their school, a group and a role; it shows in GET /users/:id', async () => {
      const res = check(
        await assign(ids.AdminA, { userId: ids.New1, schoolId: schools.A, groupId: groups.A1, role: 'student' }),
        201,
      );
      expect(res.body).toMatchObject({
        userId: ids.New1,
        schoolId: schools.A,
        groupId: groups.A1,
        groupName: 'A1',
        role: 'STUDENT',
        roleScope: 'group',
      });

      const detail = check(
        await request(app.getHttpServer()).get(`/users/${ids.New1}`).set('Authorization', await bearer(ids.AdminA)),
        200,
      );
      expect(detail.body.assignments).toEqual([
        { schoolId: schools.A, schoolName: expect.any(String), role: 'STUDENT', groupId: groups.A1, groupName: 'A1' },
      ]);
      expect(detail.body.groups).toEqual([expect.objectContaining({ groupId: groups.A1, schoolId: schools.A })]);

      const event = await prisma.auditEvent.findFirst({
        where: { action: 'role_assigned', entityId: ids.New1 },
        orderBy: { seq: 'desc' },
      });
      expect(event?.details).toMatchObject({ schoolId: schools.A, groupId: groups.A1, role: 'STUDENT' });
    });

    it('a group is optional', async () => {
      const res = check(await assign(ids.AdminA, { userId: ids.New2, schoolId: schools.A, role: 'STAFF' }), 201);
      expect(res.body).toMatchObject({ groupId: null, groupName: null, role: 'STAFF' });
    });

    it('a platform admin assigns in any school, including a platform role', async () => {
      check(await assign(platformAdminId, { userId: ids.New3, schoolId: schools.B, groupId: groups.B1, role: 'STUDENT' }), 201);
      const res = check(await assign(platformAdminId, { userId: ids.New4, schoolId: schools.B, role: 'PLATFORM_ADMIN' }), 201);
      expect(res.body).toMatchObject({ role: 'PLATFORM_ADMIN', roleScope: 'platform' });
    });

    it('rejects an invalid school / group / role combination', async () => {
      const base = { userId: ids.New2, schoolId: schools.B, role: 'STUDENT' };
      // Group of another school.
      const res = check(await assign(platformAdminId, { ...base, groupId: groups.A1 }), 400);
      expect(res.body.message).toBe('The group does not belong to this school');
      // Group on a platform role, unknown role, deactivated school, unknown school, unknown group.
      check(await assign(platformAdminId, { ...base, groupId: groups.B1, role: 'PLATFORM_ADMIN' }), 400);
      check(await assign(platformAdminId, { ...base, role: 'NOPE' }), 400);
      check(await assign(platformAdminId, { ...base, schoolId: schools.Off }), 400);
      check(await assign(platformAdminId, { ...base, schoolId: '00000000-0000-4000-8000-000000000000' }), 404);
      check(await assign(platformAdminId, { ...base, groupId: '00000000-0000-4000-8000-000000000000' }), 404);
      check(await assign(platformAdminId, { ...base, userId: '00000000-0000-4000-8000-000000000000' }), 404);
      expect((await assignmentsOf(ids.New2)).map((a) => a.schoolId)).toEqual([schools.A]);
    });

    it('rejects a role above the school admin level', async () => {
      const res = check(await assign(ids.AdminA, { userId: ids.Race, schoolId: schools.A, role: 'PLATFORM_ADMIN' }), 403);
      expect(res.body.message).toBe('Only a platform administrator can assign the PLATFORM_ADMIN role');
      expect(await assignmentsOf(ids.Race)).toHaveLength(0);
    });

    it('rejects assigning a user who outranks the school admin', async () => {
      const res = check(await assign(ids.AdminA, { userId: platformAdminId, schoolId: schools.A, role: 'STUDENT' }), 403);
      expect(res.body.message).toMatch(/higher-level role/);
      expect(await prisma.userAssignment.count({ where: { userId: platformAdminId, schoolId: schools.A } })).toBe(0);
    });

    it('rejects a second assignment in the same school (409)', async () => {
      const res = check(await assign(ids.AdminA, { userId: ids.New2, schoolId: schools.A, role: 'STUDENT' }), 409);
      expect(res.body.message).toContain('PATCH /identity/users/:id/role');
    });

    it('lets only one of two simultaneous requests create the assignment', async () => {
      const body = { userId: ids.Race, schoolId: schools.A, role: 'STUDENT' };
      const results = await Promise.all([assign(ids.AdminA, body), assign(ids.AdminA, body)]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
      expect(await assignmentsOf(ids.Race)).toHaveLength(1);
    });

    it.each([
      ['a missing userId', { schoolId: 'x', role: 'STUDENT' }],
      ['an invalid userId', { userId: 'abc', schoolId: 'x', role: 'STUDENT' }],
      ['a missing role', { userId: '00000000-0000-4000-8000-000000000000', schoolId: 'x' }],
      ['an invalid groupId', { userId: '00000000-0000-4000-8000-000000000000', schoolId: 'x', role: 'STUDENT', groupId: 'g' }],
      ['an unknown field', { userId: '00000000-0000-4000-8000-000000000000', schoolId: 'x', role: 'STUDENT', roleId: 'r' }],
    ])('rejects %s', async (_label, body) => {
      check(await assign(platformAdminId, body), 400);
    });
  });

  describe('GET /assignments/assignable-roles', () => {
    it('gives a school admin only school and group roles', async () => {
      const res = check(await assignable(ids.AdminA), 200);
      const names = res.body.map((r: { name: string }) => r.name);
      expect(names).toEqual(expect.arrayContaining(['SCHOOL_ADMIN', 'CONTENT_MANAGER', 'STAFF', 'STUDENT', 'PARENT_GUEST']));
      expect(names).not.toContain('PLATFORM_ADMIN');
      expect(res.body.every((r: { level: number }) => r.level <= 2)).toBe(true);
      expect(res.body[0]).toEqual({ id: expect.any(String), name: expect.any(String), scope: 'school', level: 2 });
    });

    it('gives a platform admin the platform role first', async () => {
      const res = check(await assignable(platformAdminId), 200);
      expect(res.body[0]).toMatchObject({ name: 'PLATFORM_ADMIN', scope: 'platform', level: 3 });
    });

    it('scopes to a school: own school 200, another school 403', async () => {
      check(await assignable(ids.AdminA, schools.A), 200);
      check(await assignable(ids.AdminA, schools.B), 403);
    });
  });

  describe('PATCH /identity/users/:id/role (same level check)', () => {
    it('a school admin sets and replaces a role in their school', async () => {
      check(await patchRole(ids.AdminA, ids.Patch1, { schoolId: schools.A, role: 'STUDENT' }), 200);
      check(await patchRole(ids.AdminA, ids.Patch1, { schoolId: schools.A, role: 'STAFF' }), 200);
      const rows = await prisma.userAssignment.findMany({ where: { userId: ids.Patch1 }, include: { role: true } });
      expect(rows.map((a) => [a.schoolId, a.role.name])).toEqual([[schools.A, 'STAFF']]);
    });

    it('still rejects a platform role for a school admin, with the same message', async () => {
      const res = check(await patchRole(ids.AdminA, ids.Patch2, { schoolId: schools.A, role: 'PLATFORM_ADMIN' }), 403);
      expect(res.body.message).toBe('Only a platform administrator can assign the PLATFORM_ADMIN role');
      expect(await assignmentsOf(ids.Patch2)).toHaveLength(0);
    });

    it('still rejects another school and a content manager', async () => {
      check(await patchRole(ids.AdminA, ids.Patch2, { schoolId: schools.B, role: 'STUDENT' }), 403);
      check(await patchRole(ids.ManagerA, ids.Patch2, { schoolId: schools.A, role: 'STUDENT' }), 403);
    });

    it('a platform admin still grants a platform role', async () => {
      check(await patchRole(platformAdminId, ids.Patch2, { schoolId: schools.B, role: 'PLATFORM_ADMIN' }), 200);
    });
  });
});
