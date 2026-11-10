import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * DELETE /assignments/:id (#49): soft delete, the access is gone on the next request, the removed assignment no
 * longer shows anywhere, and a school keeps at least one working school admin (also under concurrent deletes).
 * Uses its own schools so the admin counts do not depend on other specs.
 */
describe('DELETE /assignments/:id (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const schools = { A: '', B: '', C: '', D: '', Off: '' };
  const groups = { A1: '' };
  const ids: Record<string, string> = {};
  let platformAdminId: string;

  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const remove = async (as: string, id: string, token?: string) =>
    request(app.getHttpServer())
      .delete(`/assignments/${id}`)
      .set('Authorization', token ?? (await bearer(as)));
  const get = async (as: string, path: string, token?: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', token ?? (await bearer(as)));
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };

  /** Creates a user; returns its id. */
  async function user(key: string, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
    const created = await prisma.user.create({
      data: { email: `e2e-unassign-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status },
    });
    ids[key] = created.id;
    return created.id;
  }
  /** Gives `userId` a role in a school (and the group membership, as POST /assignments does); returns the assignment id. */
  async function assign(userId: string, schoolId: string, roleName: string, groupId: string | null = null) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    const row = await prisma.userAssignment.create({ data: { userId, schoolId, roleId: role.id, groupId } });
    if (groupId) await prisma.groupMember.create({ data: { groupId, userId } });
    return row.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    for (const key of ['A', 'B', 'C', 'D'] as const) {
      schools[key] = (await prisma.school.create({ data: { name: `Test E2E Unassign School ${key} ${stamp}` } })).id;
    }
    schools.Off = (
      await prisma.school.create({ data: { name: `Test E2E Unassign School Off ${stamp}`, status: 'deactivated' } })
    ).id;
    groups.A1 = (await prisma.group.create({ data: { schoolId: schools.A, name: 'A1' } })).id;

    // School A has two admins, so removing one of them is allowed.
    await assign(await user('AdminA'), schools.A, 'SCHOOL_ADMIN');
    await assign(await user('AdminA2'), schools.A, 'SCHOOL_ADMIN');
    await assign(await user('ManagerA'), schools.A, 'CONTENT_MANAGER');
    await assign(await user('AdminB'), schools.B, 'SCHOOL_ADMIN');
    await assign(await user('AdminB2'), schools.B, 'SCHOOL_ADMIN');

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@school.edu` } } });
    await prisma.school.deleteMany({ where: { name: { contains: `Test E2E Unassign School` } } });
    await app.close();
  });

  describe('access', () => {
    it('requires a token and a UUID', async () => {
      const id = await assign(await user('Access1'), schools.A, 'STAFF');
      await request(app.getHttpServer()).delete(`/assignments/${id}`).expect(401);
      check(await remove(platformAdminId, 'not-a-uuid'), 400);
    });

    it('rejects a content manager (no users:assign_role) and a school admin of another school', async () => {
      const id = await assign(await user('Access2'), schools.A, 'STAFF');
      check(await remove(ids.ManagerA, id), 403);
      check(await remove(ids.AdminB, id), 403);
      expect((await prisma.userAssignment.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
    });

    it('rejects removing a role above the school admin level, or a user who outranks them', async () => {
      const platformRole = await assign(await user('Boss1'), schools.A, 'PLATFORM_ADMIN');
      check(await remove(ids.AdminA, platformRole), 403);
      await assign(await user('Boss2'), schools.B, 'PLATFORM_ADMIN');
      const staffOfBoss = await assign(ids.Boss2, schools.A, 'STAFF');
      check(await remove(ids.AdminA, staffOfBoss), 403);
    });

    it('rejects a deactivated school (400)', async () => {
      const id = await assign(await user('Off1'), schools.Off, 'STAFF');
      check(await remove(platformAdminId, id), 400);
    });

    it('a platform admin removes in any school', async () => {
      const id = await assign(await user('AnyB'), schools.B, 'STAFF');
      check(await remove(platformAdminId, id), 204);
    });
  });

  describe('soft delete', () => {
    it('keeps the row with deletedAt, moves updatedAt, removes the group membership and audits', async () => {
      const id = await assign(await user('Student1'), schools.A, 'STUDENT', groups.A1);
      const before = await prisma.userAssignment.findUniqueOrThrow({ where: { id } });

      const res = check(await remove(ids.AdminA, id), 204);
      expect(res.body).toEqual({});

      const row = await prisma.userAssignment.findUniqueOrThrow({ where: { id } });
      expect(row.deletedAt).toBeInstanceOf(Date);
      expect(row.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
      expect(row.updatedAt.getTime()).toBe(row.deletedAt!.getTime());
      expect(await prisma.groupMember.count({ where: { userId: ids.Student1 } })).toBe(0);

      const event = await prisma.auditEvent.findFirst({
        where: { action: 'assignment_removed', entityId: ids.Student1 },
        orderBy: { seq: 'desc' },
      });
      expect(event).toMatchObject({ category: 'identity_access', actorId: ids.AdminA, actorRole: 'SCHOOL_ADMIN' });
      expect(event?.details).toEqual({
        assignmentId: id,
        email: `e2e-unassign-student1-${stamp}@school.edu`,
        schoolId: schools.A,
        role: 'STUDENT',
        groupId: groups.A1,
      });
    });

    it('a second DELETE and a PATCH on the removed assignment are 404, with no second audit event', async () => {
      const id = await assign(await user('Twice'), schools.A, 'STAFF');
      check(await remove(ids.AdminA, id), 204);
      check(await remove(ids.AdminA, id), 404);
      check(
        await request(app.getHttpServer())
          .patch(`/assignments/${id}`)
          .set('Authorization', await bearer(ids.AdminA))
          .send({ role: 'STUDENT' }),
        404,
      );
      expect(await prisma.auditEvent.count({ where: { action: 'assignment_removed', entityId: ids.Twice } })).toBe(1);
    });

    it('the removed assignment no longer shows in GET /users, GET /users/:id or the role count', async () => {
      const id = await assign(await user('Gone'), schools.A, 'STAFF');
      const count = async () =>
        check(await get(platformAdminId, '/identity/roles/STAFF'), 200).body.assignedUsersCount as number;
      const staffBefore = await count();

      check(await remove(ids.AdminA, id), 204);

      const list = check(await get(ids.AdminA, `/users?schoolId=${schools.A}&search=e2e-unassign-gone`), 200);
      expect(list.body.data).toEqual([]);
      // For the school admin the user is now outside their school; the platform admin sees no assignment.
      check(await get(ids.AdminA, `/users/${ids.Gone}`), 403);
      const detail = check(await get(platformAdminId, `/users/${ids.Gone}`), 200);
      expect(detail.body.assignments).toEqual([]);
      expect(await count()).toBe(staffBefore - 1);
    });

    it('the removed assignment no longer counts in the permission overview', async () => {
      const holders = async () =>
        check(await get(ids.AdminB, '/identity/permissions?code=users:assign_role'), 200).body[0];
      const holderIds = (overview: { holders: { userId: string }[] }) => overview.holders.map((h) => h.userId);
      const before = await holders();
      expect(holderIds(before)).toEqual(expect.arrayContaining([ids.AdminB, ids.AdminB2]));

      const adminB2 = await prisma.userAssignment.findFirstOrThrow({ where: { userId: ids.AdminB2 } });
      check(await remove(platformAdminId, adminB2.id), 204);

      const after = await holders();
      expect(after.holdersTotal).toBe(before.holdersTotal - 1);
      expect(holderIds(after)).toContain(ids.AdminB);
      expect(holderIds(after)).not.toContain(ids.AdminB2);
    });

    it('the user can be assigned to the same school again (no 409), as a new row', async () => {
      const id = await assign(await user('Again'), schools.A, 'STAFF');
      check(await remove(ids.AdminA, id), 204);
      const res = check(
        await request(app.getHttpServer())
          .post('/assignments')
          .set('Authorization', await bearer(ids.AdminA))
          .send({ userId: ids.Again, schoolId: schools.A, role: 'STUDENT' }),
        201,
      );
      expect(res.body.id).not.toBe(id);
      expect(await prisma.userAssignment.count({ where: { userId: ids.Again } })).toBe(2);
    });
  });

  describe('the access is gone on the next request', () => {
    it("a school admin's token stops working for their school right after the removal", async () => {
      const token = await bearer(ids.AdminA2);
      check(await get(ids.AdminA2, `/users?schoolId=${schools.A}`, token), 200);

      const own = await prisma.userAssignment.findFirstOrThrow({ where: { userId: ids.AdminA2 } });
      check(await remove(platformAdminId, own.id), 204);

      check(await get(ids.AdminA2, `/users?schoolId=${schools.A}`, token), 403);
      check(await get(ids.AdminA2, '/assignments/assignable-roles', token), 403);
    });
  });

  describe('last school admin', () => {
    it('cannot remove the only school admin; a suspended admin does not count; a working one does', async () => {
      const c1 = await assign(await user('AdminC1'), schools.C, 'SCHOOL_ADMIN');
      const res = check(await remove(platformAdminId, c1), 409);
      expect(res.body.message).toBe(
        'Cannot remove the last school administrator of this school: assign another one first',
      );

      const c2 = await assign(await user('AdminC2', 'SUSPENDED'), schools.C, 'SCHOOL_ADMIN');
      check(await remove(platformAdminId, c1), 409);

      const c3 = await assign(await user('AdminC3'), schools.C, 'SCHOOL_ADMIN');
      check(await remove(platformAdminId, c1), 204);
      // C3 is now the only working admin (C2 is suspended).
      check(await remove(ids.AdminC3, c3), 409);
      // Removing the suspended admin does not take a working admin away.
      check(await remove(platformAdminId, c2), 204);
      expect(await prisma.userAssignment.count({ where: { schoolId: schools.C, deletedAt: null } })).toBe(1);
    });

    it('two simultaneous removals of the last two admins: exactly one succeeds', async () => {
      const d1 = await assign(await user('AdminD1'), schools.D, 'SCHOOL_ADMIN');
      const d2 = await assign(await user('AdminD2'), schools.D, 'SCHOOL_ADMIN');
      const [t1, t2] = [await bearer(platformAdminId), await bearer(platformAdminId)];

      const results = await Promise.all([remove(platformAdminId, d1, t1), remove(platformAdminId, d2, t2)]);

      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([204, 409]);
      expect(await prisma.userAssignment.count({ where: { schoolId: schools.D, deletedAt: null } })).toBe(1);
    });
  });
});
