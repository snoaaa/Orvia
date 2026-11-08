import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { UserStatus } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** GET /users (#38): scoping, search, combinable filters, pagination, no secrets. */
describe('Users list (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  // Every user of this suite has the stamp in its name, so `search=stamp` isolates them from other data.
  const tag = `U${stamp}`;
  const schools = { A: '', B: '' };
  const groups = { A1: '', B1: '' };
  const ids: Record<string, string> = {};
  let platformAdminId: string;

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const list = async (as: string, query: Record<string, string | number> = {}) =>
    http()
      .get('/users')
      .query({ search: tag, limit: 100, ...query })
      .set('Authorization', await bearer(as));
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  const names = (body: { data: { fullName: string }[] }) => body.data.map((u) => u.fullName.replace(`${tag} `, '')).sort();

  async function user(
    key: string,
    assignments: { school: 'A' | 'B'; role: string; group?: 'A1' | 'B1' }[],
    status: UserStatus = 'ACTIVE',
  ) {
    const created = await prisma.user.create({
      data: { email: `e2e-users-${key.toLowerCase()}-${stamp}@school.edu`, fullName: `${tag} ${key}`, status },
    });
    for (const a of assignments) {
      const role = await prisma.role.findUniqueOrThrow({ where: { name: a.role } });
      await prisma.userAssignment.create({
        data: { userId: created.id, schoolId: schools[a.school], roleId: role.id, groupId: a.group ? groups[a.group] : null },
      });
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

    schools.A = (await prisma.school.create({ data: { name: `Test E2E Users School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E Users School B ${stamp}` } })).id;
    groups.A1 = (await prisma.group.create({ data: { schoolId: schools.A, name: 'A1' } })).id;
    groups.B1 = (await prisma.group.create({ data: { schoolId: schools.B, name: 'B1' } })).id;

    await user('AdminA', [{ school: 'A', role: 'SCHOOL_ADMIN' }]);
    await user('ManagerA', [{ school: 'A', role: 'CONTENT_MANAGER' }]);
    await user('StudentA', [{ school: 'A', role: 'STUDENT' }]);
    await user('StaffA', [{ school: 'A', role: 'STAFF', group: 'A1' }]);
    await user('MemberA', [{ school: 'A', role: 'STUDENT' }]);
    await prisma.groupMember.create({ data: { groupId: groups.A1, userId: ids.MemberA } });
    await user('StaffB', [{ school: 'B', role: 'STAFF', group: 'B1' }]);
    await user('Both', [{ school: 'A', role: 'STUDENT' }, { school: 'B', role: 'STAFF' }], 'SUSPENDED');
    await user('Orphan', [], 'INVITED');

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@school.edu` } } });
    await prisma.school.deleteMany({ where: { name: { contains: `Test E2E Users School` } } });
    await app.close();
  });

  describe('access', () => {
    it('requires a token', async () => {
      await http().get('/users').expect(401);
    });

    it.each(['StudentA', 'ManagerA'])('rejects %s (no users:read permission)', async (key) => {
      check(await list(ids[key]), 403);
    });
  });

  describe('scoping', () => {
    it('a platform admin sees users of every school, including users without a school', async () => {
      const res = check(await list(platformAdminId), 200);
      expect(names(res.body)).toEqual(['AdminA', 'Both', 'ManagerA', 'MemberA', 'Orphan', 'StaffA', 'StaffB', 'StudentA']);
    });

    it('a school admin only sees users of their school', async () => {
      const res = check(await list(ids.AdminA), 200);
      expect(names(res.body)).toEqual(['AdminA', 'Both', 'ManagerA', 'MemberA', 'StaffA', 'StudentA']);
    });

    it("a school admin only sees the user's assignments in their own school", async () => {
      const res = check(await list(ids.AdminA, { search: `${tag} Both` }), 200);
      expect(res.body.data[0].assignments).toEqual([
        expect.objectContaining({ schoolId: schools.A, role: 'STUDENT', groupId: null, groupName: null }),
      ]);
      const asPlatform = check(await list(platformAdminId, { search: `${tag} Both` }), 200);
      expect(asPlatform.body.data[0].assignments).toHaveLength(2);
    });

    it("a school admin cannot filter on another school or another school's group", async () => {
      check(await list(ids.AdminA, { schoolId: schools.B }), 403);
      check(await list(ids.AdminA, { groupId: groups.B1 }), 403);
    });
  });

  describe('search', () => {
    it('matches part of the name, ignoring case', async () => {
      const res = check(await list(platformAdminId, { search: `${tag} staff`.toLowerCase() }), 200);
      expect(names(res.body)).toEqual(['StaffA', 'StaffB']);
    });

    it('matches part of the email', async () => {
      const res = check(await list(platformAdminId, { search: `e2e-users-membera-${stamp}` }), 200);
      expect(names(res.body)).toEqual(['MemberA']);
    });
  });

  describe('filters', () => {
    it('by school', async () => {
      const res = check(await list(platformAdminId, { schoolId: schools.B }), 200);
      expect(names(res.body)).toEqual(['Both', 'StaffB']);
    });

    it('by role (case-insensitive)', async () => {
      const res = check(await list(platformAdminId, { role: 'staff' }), 200);
      expect(names(res.body)).toEqual(['Both', 'StaffA', 'StaffB']);
    });

    it('by status', async () => {
      const res = check(await list(platformAdminId, { status: 'suspended' }), 200);
      expect(names(res.body)).toEqual(['Both']);
    });

    it('by group, through an assignment or a group membership', async () => {
      const res = check(await list(platformAdminId, { groupId: groups.A1 }), 200);
      expect(names(res.body)).toEqual(['MemberA', 'StaffA']);
    });

    it('combined: school and role must match the same assignment', async () => {
      // "Both" is STAFF in B and STUDENT in A: not "STAFF in A".
      const res = check(await list(platformAdminId, { schoolId: schools.A, role: 'STAFF' }), 200);
      expect(names(res.body)).toEqual(['StaffA']);
    });

    it('combined: school admin + role + status', async () => {
      const res = check(await list(ids.AdminA, { role: 'STUDENT', status: 'ACTIVE' }), 200);
      expect(names(res.body)).toEqual(['MemberA', 'StudentA']);
    });

    it('rejects an unknown role, an invalid status and an unknown group', async () => {
      check(await list(platformAdminId, { role: 'WIZARD' }), 400);
      check(await list(platformAdminId, { status: 'DELETED' }), 400);
      check(await list(platformAdminId, { groupId: '00000000-0000-4000-8000-000000000000' }), 404);
    });
  });

  describe('pagination and sorting', () => {
    it('pages through the results without overlap', async () => {
      const first = check(await list(platformAdminId, { limit: 3, page: 1, sortBy: 'fullName', sortOrder: 'asc' }), 200);
      const third = check(await list(platformAdminId, { limit: 3, page: 3, sortBy: 'fullName', sortOrder: 'asc' }), 200);
      expect(first.body).toMatchObject({ total: 8, page: 1, limit: 3, totalPages: 3 });
      expect(names(first.body)).toEqual(['AdminA', 'Both', 'ManagerA']);
      expect(names(third.body)).toEqual(['StudentA', 'StaffB'].sort());
    });

    it('sorts by full name descending', async () => {
      const res = check(await list(platformAdminId, { sortBy: 'fullName', sortOrder: 'desc' }), 200);
      const ordered = res.body.data.map((u: { fullName: string }) => u.fullName.replace(`${tag} `, ''));
      expect(ordered).toEqual(['StudentA', 'StaffB', 'StaffA', 'Orphan', 'MemberA', 'ManagerA', 'Both', 'AdminA']);
    });

    it('defaults to A-Z for text columns and newest first for createdAt', async () => {
      const byName = check(await list(platformAdminId, { sortBy: 'fullName' }), 200);
      expect(byName.body.data.map((u: { fullName: string }) => u.fullName.replace(`${tag} `, ''))).toEqual([
        'AdminA', 'Both', 'ManagerA', 'MemberA', 'Orphan', 'StaffA', 'StaffB', 'StudentA',
      ]);
      const byDate = check(await list(platformAdminId), 200);
      const dates = byDate.body.data.map((u: { createdAt: string }) => new Date(u.createdAt).getTime());
      expect(dates).toEqual([...dates].sort((a, b) => b - a));
    });

    it('GET /identity/users answers with the same implementation and scoping', async () => {
      const res = await http()
        .get('/identity/users')
        .query({ search: tag, limit: 100, sortBy: 'fullName', sortOrder: 'asc' })
        .set('Authorization', await bearer(ids.AdminA));
      check(res, 200);
      expect(names(res.body)).toEqual(['AdminA', 'Both', 'ManagerA', 'MemberA', 'StaffA', 'StudentA']);
      expect(res.body.data[0].assignments).toHaveLength(1);
    });

    it('rejects invalid pagination or sort parameters', async () => {
      check(await list(platformAdminId, { limit: 101 }), 400);
      check(await list(platformAdminId, { page: 0 }), 400);
      check(await list(platformAdminId, { sortBy: 'passwordHash' }), 400);
    });
  });

  it('never returns password hashes, tokens or the Google id', async () => {
    await prisma.user.update({ where: { id: ids.StudentA }, data: { passwordHash: '$2b$12$secretsecretsecretsecretsecret' } });
    const res = check(await list(platformAdminId), 200);
    const raw = JSON.stringify(res.body);
    for (const field of ['passwordHash', 'password_hash', 'googleSub', 'setupToken', 'refreshToken', '$2b$12$']) {
      expect(raw).not.toContain(field);
    }
  });
});
