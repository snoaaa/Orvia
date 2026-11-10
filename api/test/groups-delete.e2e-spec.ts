import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** DELETE /groups/:id (#35): soft delete, memberships and group access removed, other access kept. */
describe('Group deletion (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const tag = `D${stamp}`;
  const schools = { A: '', B: '', Off: '' };
  const ids: Record<string, string> = {};
  let platformAdminId: string;
  let documentId: string;

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const remove = async (as: string, id: string) =>
    http()
      .delete(`/groups/${id}`)
      .set('Authorization', await bearer(as));
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  const group = async (school: keyof typeof schools, name: string) =>
    (await prisma.group.create({ data: { schoolId: schools[school], name: `${tag} ${name}` } })).id;

  async function user(key: string, roleName: string) {
    const created = await prisma.user.create({
      data: { email: `e2e-groupsdelete-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status: 'ACTIVE' },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await prisma.userAssignment.create({ data: { userId: created.id, schoolId: schools.A, roleId: role.id } });
    ids[key] = created.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    schools.A = (await prisma.school.create({ data: { name: `Test E2E GroupsDelete School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E GroupsDelete School B ${stamp}` } })).id;
    schools.Off = (
      await prisma.school.create({ data: { name: `Test E2E GroupsDelete School Off ${stamp}`, status: 'deactivated' } })
    ).id;
    const space = await prisma.space.create({ data: { schoolId: schools.A, name: `${tag} space` } });
    documentId = (await prisma.document.create({ data: { spaceId: space.id, title: `${tag} doc` } })).id;

    await user('AdminA', 'SCHOOL_ADMIN');
    await user('ManagerA', 'CONTENT_MANAGER');
    await user('StudentA', 'STUDENT');

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@school.edu` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E GroupsDelete School' } } });
    await app.close();
  });

  describe('access', () => {
    it('requires a token', async () => {
      await http().delete(`/groups/${await group('A', 'NoToken')}`).expect(401);
    });

    it.each(['ManagerA', 'StudentA'])('rejects %s (no groups:delete permission)', async (key) => {
      const id = await group('A', `Denied ${key}`);
      check(await remove(ids[key], id), 403);
      expect((await prisma.group.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
    });

    it('a school admin cannot delete a group of another school', async () => {
      check(await remove(ids.AdminA, await group('B', 'Other school')), 403);
    });

    it('a platform admin can delete a group of any school', async () => {
      check(await remove(platformAdminId, await group('B', 'By platform')), 204);
    });
  });

  describe('soft delete', () => {
    let id: string;
    let otherId: string;

    beforeAll(async () => {
      id = await group('A', 'ISI 4');
      otherId = await group('A', 'Kept');
      // StudentA: a member of both groups, with a school role assigned through the deleted group.
      await prisma.groupMember.create({ data: { groupId: id, userId: ids.StudentA } });
      await prisma.groupMember.create({ data: { groupId: otherId, userId: ids.StudentA } });
      await prisma.userAssignment.updateMany({ where: { userId: ids.StudentA }, data: { groupId: id } });
      await prisma.documentAccess.create({ data: { documentId, groupId: id } });
      await prisma.documentAccess.create({ data: { documentId, groupId: otherId } });
      await prisma.documentAccess.create({ data: { documentId, schoolId: schools.A } });

      check(await remove(ids.AdminA, id), 204);
    });

    it('keeps the row with deleted_at and a renamed name', async () => {
      const row = await prisma.group.findUniqueOrThrow({ where: { id } });
      expect(row.deletedAt).not.toBeNull();
      expect(row.name).toBe(`${tag} ISI 4 [deleted ${row.deletedAt!.toISOString()}]`);
    });

    it('removes its memberships but not those of other groups', async () => {
      expect(await prisma.groupMember.count({ where: { groupId: id } })).toBe(0);
      expect(await prisma.groupMember.count({ where: { groupId: otherId, userId: ids.StudentA } })).toBe(1);
    });

    it('removes the document access it granted, and only that', async () => {
      const rows = await prisma.documentAccess.findMany({ where: { documentId } });
      expect(rows.map((r) => r.groupId ?? r.schoolId).sort()).toEqual([otherId, schools.A].sort());
    });

    it('members keep their school role without the group', async () => {
      const assignments = await prisma.userAssignment.findMany({ where: { userId: ids.StudentA } });
      expect(assignments).toHaveLength(1);
      expect(assignments[0]).toMatchObject({ schoolId: schools.A, groupId: null });
      const res = await http().get('/auth/me').set('Authorization', await bearer(ids.StudentA));
      check(res, 200);
    });

    it('no longer appears in lists, and the group routes answer 404', async () => {
      const auth = await bearer(ids.AdminA);
      const list = check(await http().get('/groups').query({ search: tag, limit: 100 }).set('Authorization', auth), 200);
      const listed = list.body.data.map((g: { id: string }) => g.id);
      expect(listed).toContain(otherId);
      expect(listed).not.toContain(id);
      check(await http().get(`/groups/${id}`).set('Authorization', auth), 404);
      check(await http().patch(`/groups/${id}`).set('Authorization', auth).send({ name: 'Back' }), 404);
      check(await http().get('/users').query({ groupId: id }).set('Authorization', auth), 404);
      check(await remove(ids.AdminA, id), 404);
    });

    it('lets a new group take the name', async () => {
      const res = check(
        await http()
          .post('/groups')
          .set('Authorization', await bearer(ids.AdminA))
          .send({ schoolId: schools.A, name: `${tag} ISI 4` }),
        201,
      );
      expect(res.body.id).not.toBe(id);
    });
  });

  describe('errors', () => {
    it('only one of two simultaneous deletes succeeds', async () => {
      const id = await group('A', 'Race');
      const results = await Promise.all([remove(ids.AdminA, id), remove(ids.AdminA, id)]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([204, 404]);
    });

    it('rejects a group of a deactivated school', async () => {
      check(await remove(platformAdminId, await group('Off', 'Frozen')), 400);
    });

    it('answers 400 for an invalid id and 404 for an unknown group', async () => {
      check(await remove(platformAdminId, 'abc'), 400);
      check(await remove(platformAdminId, '00000000-0000-4000-8000-000000000000'), 404);
    });
  });
});
