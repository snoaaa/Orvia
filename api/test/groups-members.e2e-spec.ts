import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** POST /groups/:id/members (#36): same-school users only, no duplicates, all or nothing. */
describe('Group members: add (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const tag = `M${stamp}`;
  const schools = { A: '', B: '', Off: '' };
  const ids: Record<string, string> = {};
  let platformAdminId: string;

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const add = async (as: string, groupId: string, userIds: unknown) =>
    http()
      .post(`/groups/${groupId}/members`)
      .set('Authorization', await bearer(as))
      .send({ userIds });
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  const group = async (school: keyof typeof schools, name: string) =>
    (await prisma.group.create({ data: { schoolId: schools[school], name: `${tag} ${name}` } })).id;
  const members = async (groupId: string) =>
    (await prisma.groupMember.findMany({ where: { groupId } })).map((m) => m.userId).sort();

  async function user(key: string, school: keyof typeof schools | null, roleName = 'STUDENT', status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' = 'ACTIVE') {
    const created = await prisma.user.create({
      data: { email: `e2e-groupsmembers-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status },
    });
    if (school) {
      const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
      await prisma.userAssignment.create({ data: { userId: created.id, schoolId: schools[school], roleId: role.id } });
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

    schools.A = (await prisma.school.create({ data: { name: `Test E2E GroupsMembers School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E GroupsMembers School B ${stamp}` } })).id;
    schools.Off = (
      await prisma.school.create({ data: { name: `Test E2E GroupsMembers School Off ${stamp}`, status: 'deactivated' } })
    ).id;

    await user('AdminA', 'A', 'SCHOOL_ADMIN');
    await user('ManagerA', 'A', 'CONTENT_MANAGER');
    await user('Student1', 'A');
    await user('Student2', 'A');
    await user('Invited', 'A', 'STUDENT', 'INVITED');
    await user('Suspended', 'A', 'STUDENT', 'SUSPENDED');
    await user('StudentB', 'B');
    await user('Orphan', null);
    await user('StudentOff', 'Off');

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@school.edu` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E GroupsMembers School' } } });
    await app.close();
  });

  describe('access', () => {
    it('requires a token', async () => {
      await http().post(`/groups/${await group('A', 'NoToken')}/members`).send({ userIds: [ids.Student1] }).expect(401);
    });

    it.each(['ManagerA', 'Student1'])('rejects %s (no groups:manage_members permission)', async (key) => {
      const id = await group('A', `Denied ${key}`);
      check(await add(ids[key], id, [ids.Student2]), 403);
      expect(await members(id)).toEqual([]);
    });

    it('a school admin cannot add members to a group of another school', async () => {
      check(await add(ids.AdminA, await group('B', 'Other school'), [ids.StudentB]), 403);
    });

    it('a platform admin can add members in any school', async () => {
      const id = await group('B', 'By platform');
      const res = check(await add(platformAdminId, id, [ids.StudentB]), 200);
      expect(res.body).toEqual({ added: [ids.StudentB], alreadyMembers: [], memberCount: 1 });
    });
  });

  describe('adding', () => {
    it('adds several users of the school, including invited and suspended ones', async () => {
      const id = await group('A', 'Several');
      const userIds = [ids.Student1, ids.Student2, ids.Invited, ids.Suspended];
      const res = check(await add(ids.AdminA, id, userIds), 200);
      expect(res.body.added.sort()).toEqual([...userIds].sort());
      expect(res.body).toMatchObject({ alreadyMembers: [], memberCount: 4 });
      expect(await members(id)).toEqual([...userIds].sort());
    });

    it('ignores users already in the group and repeated ids', async () => {
      const id = await group('A', 'Twice');
      check(await add(ids.AdminA, id, [ids.Student1]), 200);
      const res = check(await add(ids.AdminA, id, [ids.Student1, ids.Student2, ids.Student2]), 200);
      expect(res.body).toEqual({ added: [ids.Student2], alreadyMembers: [ids.Student1], memberCount: 2 });
      expect(await members(id)).toEqual([ids.Student1, ids.Student2].sort());
    });

    it('changes updated_at only when someone is added', async () => {
      const id = await group('A', 'Touched');
      const past = new Date(Date.now() - 60_000);
      await prisma.group.update({ where: { id }, data: { updatedAt: past } });

      check(await add(ids.AdminA, id, [ids.Student1]), 200);
      const touched = (await prisma.group.findUniqueOrThrow({ where: { id } })).updatedAt;
      expect(touched.getTime()).toBeGreaterThan(past.getTime());

      await prisma.group.update({ where: { id }, data: { updatedAt: past } });
      check(await add(ids.AdminA, id, [ids.Student1]), 200);
      expect((await prisma.group.findUniqueOrThrow({ where: { id } })).updatedAt.getTime()).toBe(past.getTime());
    });

    it('shows up in the member count of the group', async () => {
      const id = await group('A', 'Counted');
      check(await add(ids.AdminA, id, [ids.Student1, ids.Student2]), 200);
      const res = check(await http().get(`/groups/${id}`).set('Authorization', await bearer(ids.AdminA)), 200);
      expect(res.body.memberCount).toBe(2);
    });

    it('two simultaneous requests do not create duplicates', async () => {
      const id = await group('A', 'Race');
      const results = await Promise.all([add(ids.AdminA, id, [ids.Student1]), add(ids.AdminA, id, [ids.Student1])]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(await members(id)).toEqual([ids.Student1]);
    });
  });

  describe('with a simultaneous delete', () => {
    it('never leaves members in a deleted group', async () => {
      for (let i = 0; i < 5; i++) {
        const id = await group('A', `Delete race ${i}`);
        const [added, deleted] = await Promise.all([
          add(ids.AdminA, id, [ids.Student1, ids.Student2]),
          http().delete(`/groups/${id}`).set('Authorization', await bearer(ids.AdminA)),
        ]);
        expect(deleted.status).toBe(204);
        expect([200, 404]).toContain(added.status);
        expect(await members(id)).toEqual([]);
      }
    });
  });

  describe('same school only', () => {
    it.each([
      ['a user of another school', 'StudentB'],
      ['a user without a school', 'Orphan'],
    ])('rejects %s, and adds nobody', async (_label, key) => {
      const id = await group('A', `Wrong ${key}`);
      const res = check(await add(ids.AdminA, id, [ids.Student1, ids[key]]), 400);
      expect(res.body.message).toContain(ids[key]);
      expect(res.body.message).not.toContain(ids.Student1);
      expect(await members(id)).toEqual([]);
    });

    it('answers an unknown user like a user of another school', async () => {
      const unknown = '00000000-0000-4000-8000-000000000000';
      const res = check(await add(ids.AdminA, await group('A', 'Unknown user'), [unknown]), 400);
      expect(res.body.message).toContain(unknown);
    });
  });

  describe('errors', () => {
    it.each([
      ['no body', undefined],
      ['an empty list', []],
      ['an invalid id', ['abc']],
      ['more than 100 ids', Array.from({ length: 101 }, () => '00000000-0000-4000-8000-000000000000')],
      ['a string instead of a list', 'abc'],
    ])('rejects %s', async (_label, userIds) => {
      check(await add(platformAdminId, await group('A', `Invalid ${_label}`), userIds), 400);
    });

    it('answers 404 for an unknown or deleted group, and 400 for an invalid group id', async () => {
      check(await add(platformAdminId, '00000000-0000-4000-8000-000000000000', [ids.Student1]), 404);
      const deleted = await group('A', 'Deleted');
      await http().delete(`/groups/${deleted}`).set('Authorization', await bearer(ids.AdminA)).expect(204);
      check(await add(ids.AdminA, deleted, [ids.Student1]), 404);
      check(await add(platformAdminId, 'abc', [ids.Student1]), 400);
    });

    it('rejects a group of a deactivated school', async () => {
      check(await add(platformAdminId, await group('Off', 'Frozen'), [ids.StudentOff]), 400);
    });
  });
});
