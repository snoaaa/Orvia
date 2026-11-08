import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { SYSTEM_AUDIT_CONTEXT } from '../src/audit/utils/audit-request-context.util.js';
import { SessionService } from '../src/auth/services/session.service.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** GET /users/:id (#39): content, school scoping, active sessions only, no secrets. */
describe('User detail (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let sessions: SessionService;
  const stamp = Date.now();
  const schools = { A: '', B: '' };
  const groups = { A1: '', B1: '' };
  const ids: Record<string, string> = {};
  let platformAdminId: string;

  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const view = async (as: string, id: string) =>
    request(app.getHttpServer())
      .get(`/users/${id}`)
      .set('Authorization', await bearer(as));
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };

  async function user(key: string, assignments: { school: 'A' | 'B'; role: string; group?: 'A1' | 'B1' }[]) {
    const created = await prisma.user.create({
      data: { email: `e2e-userdetail-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status: 'ACTIVE' },
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
    sessions = app.get(SessionService);

    schools.A = (await prisma.school.create({ data: { name: `Test E2E UserDetail School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E UserDetail School B ${stamp}` } })).id;
    groups.A1 = (await prisma.group.create({ data: { schoolId: schools.A, name: 'A1' } })).id;
    groups.B1 = (await prisma.group.create({ data: { schoolId: schools.B, name: 'B1' } })).id;

    await user('AdminA', [{ school: 'A', role: 'SCHOOL_ADMIN' }]);
    await user('ManagerA', [{ school: 'A', role: 'CONTENT_MANAGER' }]);
    await user('StudentA', [{ school: 'A', role: 'STUDENT', group: 'A1' }]);
    await user('StaffB', [{ school: 'B', role: 'STAFF' }]);
    await user('Both', [{ school: 'A', role: 'STUDENT' }, { school: 'B', role: 'STAFF' }]);
    await user('Orphan', []);
    await prisma.groupMember.create({ data: { groupId: groups.A1, userId: ids.Both } });
    await prisma.groupMember.create({ data: { groupId: groups.B1, userId: ids.Both } });

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@school.edu` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E UserDetail School' } } });
    await app.close();
  });

  describe('access', () => {
    it('requires a token', async () => {
      await request(app.getHttpServer()).get(`/users/${ids.StudentA}`).expect(401);
    });

    it.each(['StudentA', 'ManagerA'])('rejects %s (no users:read permission)', async (key) => {
      check(await view(ids[key], ids.StudentA), 403);
    });

    it('answers 400 for an invalid id and 404 for an unknown user', async () => {
      check(await view(platformAdminId, 'not-a-uuid'), 400);
      check(await view(platformAdminId, '00000000-0000-4000-8000-000000000000'), 404);
    });
  });

  describe('content', () => {
    it('returns the profile, assignments and groups', async () => {
      const res = check(await view(platformAdminId, ids.StudentA), 200);
      expect(res.body).toMatchObject({
        id: ids.StudentA,
        email: `e2e-userdetail-studenta-${stamp}@school.edu`,
        fullName: 'StudentA',
        authProvider: 'local',
        status: 'ACTIVE',
        hasPassword: false,
        googleLinked: false,
        groups: [],
        sessions: [],
      });
      expect(res.body.assignments).toEqual([
        { schoolId: schools.A, schoolName: expect.any(String), role: 'STUDENT', groupId: groups.A1, groupName: 'A1' },
      ]);
    });

    it('lists active sessions with their device, not revoked or expired ones', async () => {
      const id = ids.StaffB;
      const device = await prisma.device.create({ data: { userId: id, platform: 'android' } });
      const active = await sessions.createSession(id, SYSTEM_AUDIT_CONTEXT, device.id);
      const revoked = await sessions.createSession(id, SYSTEM_AUDIT_CONTEXT);
      const expired = await sessions.createSession(id, SYSTEM_AUDIT_CONTEXT);
      await prisma.session.update({ where: { id: revoked.sessionId }, data: { revokedAt: new Date() } });
      await prisma.session.update({ where: { id: expired.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });

      const res = check(await view(platformAdminId, id), 200);
      expect(res.body.sessions).toHaveLength(1);
      expect(res.body.sessions[0]).toMatchObject({
        id: active.sessionId,
        current: false,
        device: { id: device.id, platform: 'android' },
      });
    });

    it('never returns password hashes, tokens or the Google id', async () => {
      const id = ids.Orphan;
      await prisma.user.update({
        where: { id },
        data: { passwordHash: '$2b$12$secretsecretsecretsecretsecret', googleSub: `google-sub-${stamp}` },
      });
      const pair = await sessions.createSession(id, SYSTEM_AUDIT_CONTEXT);

      const res = check(await view(platformAdminId, id), 200);
      expect(res.body).toMatchObject({ hasPassword: true, googleLinked: true });
      const raw = JSON.stringify(res.body);
      for (const value of ['passwordHash', 'password_hash', 'googleSub', 'setupToken', 'refreshToken', 'refreshTokenHash', '$2b$12$', `google-sub-${stamp}`, pair.refreshToken]) {
        expect(raw).not.toContain(value);
      }
    });
  });

  describe('scoping', () => {
    it('a school admin can view a user of their school', async () => {
      check(await view(ids.AdminA, ids.StudentA), 200);
    });

    it('a school admin gets 403 for another school or a user without a school', async () => {
      check(await view(ids.AdminA, ids.StaffB), 403);
      check(await view(ids.AdminA, ids.Orphan), 403);
    });

    it('a school admin only sees assignments and groups of their own school', async () => {
      const res = check(await view(ids.AdminA, ids.Both), 200);
      expect(res.body.assignments.map((a: { schoolId: string }) => a.schoolId)).toEqual([schools.A]);
      expect(res.body.groups).toEqual([
        { groupId: groups.A1, groupName: 'A1', groupType: 'class', schoolId: schools.A, schoolName: expect.any(String) },
      ]);
    });

    it('a platform admin sees every school', async () => {
      const res = check(await view(platformAdminId, ids.Both), 200);
      expect(res.body.assignments).toHaveLength(2);
      expect(res.body.groups).toHaveLength(2);
    });
  });
});
