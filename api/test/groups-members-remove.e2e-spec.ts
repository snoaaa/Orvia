import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** DELETE /groups/:id/members/:userId (#37): access from the group removed, school role kept, clear errors. */
describe('Group members: remove (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const tag = `R${stamp}`;
  const schools = { A: '', B: '', Off: '' };
  const ids: Record<string, string> = {};
  let platformAdminId: string;

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const remove = async (as: string, groupId: string, userId: string) =>
    http()
      .delete(`/groups/${groupId}/members/${userId}`)
      .set('Authorization', await bearer(as));
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  /** A group of `school` with the given users as members. */
  const group = async (school: keyof typeof schools, name: string, memberKeys: string[] = []) => {
    const id = (await prisma.group.create({ data: { schoolId: schools[school], name: `${tag} ${name}` } })).id;
    for (const key of memberKeys) {
      await prisma.groupMember.create({ data: { groupId: id, userId: ids[key] } });
    }
    return id;
  };
  const isMember = async (groupId: string, key: string) =>
    (await prisma.groupMember.count({ where: { groupId, userId: ids[key] } })) === 1;

  async function user(key: string, school: keyof typeof schools, roleName = 'STUDENT') {
    const created = await prisma.user.create({
      data: { email: `e2e-groupsremove-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status: 'ACTIVE' },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await prisma.userAssignment.create({ data: { userId: created.id, schoolId: schools[school], roleId: role.id } });
    ids[key] = created.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    schools.A = (await prisma.school.create({ data: { name: `Test E2E GroupsRemove School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E GroupsRemove School B ${stamp}` } })).id;
    schools.Off = (
      await prisma.school.create({ data: { name: `Test E2E GroupsRemove School Off ${stamp}`, status: 'deactivated' } })
    ).id;

    await user('AdminA', 'A', 'SCHOOL_ADMIN');
    await user('ManagerA', 'A', 'CONTENT_MANAGER');
    await user('Student1', 'A');
    await user('Student2', 'A');
    await user('StudentB', 'B');
    await user('StudentOff', 'Off');

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@school.edu` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E GroupsRemove School' } } });
    await app.close();
  });

  describe('access', () => {
    it('requires a token', async () => {
      const id = await group('A', 'NoToken', ['Student1']);
      await http().delete(`/groups/${id}/members/${ids.Student1}`).expect(401);
    });

    it.each(['ManagerA', 'Student2'])('rejects %s (no groups:manage_members permission)', async (key) => {
      const id = await group('A', `Denied ${key}`, ['Student1']);
      check(await remove(ids[key], id, ids.Student1), 403);
      expect(await isMember(id, 'Student1')).toBe(true);
    });

    it('a school admin cannot remove a member of a group of another school', async () => {
      const id = await group('B', 'Other school', ['StudentB']);
      check(await remove(ids.AdminA, id, ids.StudentB), 403);
      expect(await isMember(id, 'StudentB')).toBe(true);
    });

    it('a platform admin can remove a member in any school', async () => {
      const id = await group('B', 'By platform', ['StudentB']);
      check(await remove(platformAdminId, id, ids.StudentB), 204);
      expect(await isMember(id, 'StudentB')).toBe(false);
    });
  });

  describe('removing', () => {
    it('removes only that membership and changes updated_at', async () => {
      const id = await group('A', 'Main', ['Student1', 'Student2']);
      const other = await group('A', 'Other group', ['Student1']);
      const past = new Date(Date.now() - 60_000);
      await prisma.group.update({ where: { id }, data: { updatedAt: past } });

      check(await remove(ids.AdminA, id, ids.Student1), 204);
      expect(await isMember(id, 'Student1')).toBe(false);
      expect(await isMember(id, 'Student2')).toBe(true);
      expect(await isMember(other, 'Student1')).toBe(true);
      const row = await prisma.group.findUniqueOrThrow({ where: { id } });
      expect(row.updatedAt.getTime()).toBeGreaterThan(past.getTime());

      const res = check(await http().get(`/groups/${id}`).set('Authorization', await bearer(ids.AdminA)), 200);
      expect(res.body.memberCount).toBe(1);
    });

    it('the user loses the group on their assignments but keeps their school role', async () => {
      const id = await group('A', 'Linked', ['Student2']);
      await prisma.userAssignment.updateMany({ where: { userId: ids.Student2 }, data: { groupId: id } });

      check(await remove(ids.AdminA, id, ids.Student2), 204);
      const assignments = await prisma.userAssignment.findMany({ where: { userId: ids.Student2 } });
      expect(assignments).toHaveLength(1);
      expect(assignments[0]).toMatchObject({ schoolId: schools.A, groupId: null });
      check(await http().get('/auth/me').set('Authorization', await bearer(ids.Student2)), 200);
    });
  });

  describe('errors', () => {
    it('removing a non-member answers 404 with a clear message', async () => {
      const id = await group('A', 'Not member', ['Student1']);
      const res = check(await remove(ids.AdminA, id, ids.Student2), 404);
      expect(res.body.message).toBe(`User ${ids.Student2} is not a member of this group`);
    });

    it('removing the same member twice answers 404 the second time', async () => {
      const id = await group('A', 'Twice', ['Student1']);
      check(await remove(ids.AdminA, id, ids.Student1), 204);
      check(await remove(ids.AdminA, id, ids.Student1), 404);
    });

    it('only one of two simultaneous removals succeeds', async () => {
      const id = await group('A', 'Race', ['Student1']);
      const results = await Promise.all([remove(ids.AdminA, id, ids.Student1), remove(ids.AdminA, id, ids.Student1)]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([204, 404]);
    });

    it('never touches a group deleted at the same time', async () => {
      for (let i = 0; i < 5; i++) {
        const id = await group('A', `Delete race ${i}`, ['Student1']);
        const past = new Date(Date.now() - 60_000);
        const [removed, deleted] = await Promise.all([
          remove(ids.AdminA, id, ids.Student1),
          http().delete(`/groups/${id}`).set('Authorization', await bearer(ids.AdminA)),
        ]);
        expect(deleted.status).toBe(204);
        expect([204, 404]).toContain(removed.status);
        const row = await prisma.group.findUniqueOrThrow({ where: { id } });
        // The deletion is the last write: updated_at is its date, not a later member removal.
        expect(row.updatedAt.getTime()).toBe(row.deletedAt!.getTime());
        expect(row.updatedAt.getTime()).toBeGreaterThan(past.getTime());
      }
    });

    it('answers 404 for an unknown or deleted group', async () => {
      check(await remove(platformAdminId, '00000000-0000-4000-8000-000000000000', ids.Student1), 404);
      const deleted = await group('A', 'Deleted', ['Student1']);
      await http().delete(`/groups/${deleted}`).set('Authorization', await bearer(ids.AdminA)).expect(204);
      const res = check(await remove(ids.AdminA, deleted, ids.Student1), 404);
      expect(res.body.message).toContain('Group');
    });

    it('answers 400 for an invalid group or user id', async () => {
      const id = await group('A', 'Invalid ids', ['Student1']);
      check(await remove(platformAdminId, 'abc', ids.Student1), 400);
      check(await remove(platformAdminId, id, 'abc'), 400);
    });

    it('rejects a group of a deactivated school', async () => {
      const id = await group('Off', 'Frozen', ['StudentOff']);
      check(await remove(platformAdminId, id, ids.StudentOff), 400);
      expect(await isMember(id, 'StudentOff')).toBe(true);
    });
  });
});
