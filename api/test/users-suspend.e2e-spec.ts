import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { SYSTEM_AUDIT_CONTEXT } from '../src/audit/utils/audit-request-context.util.js';
import { SessionService } from '../src/auth/services/session.service.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** PATCH /users/:id/suspend (#41): who can suspend whom, revoked sessions, blocked sign-in and refresh. */
describe('User suspension (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let sessions: SessionService;
  const stamp = Date.now();
  const googleDomain = `suspend-e2e-${stamp}.edu`;
  const schools = { A: '', B: '' };
  const ids: Record<string, string> = {};
  let platformAdminId: string;

  const mail = (key: string, domain = 'school.edu') => `e2e-suspend-${key.toLowerCase()}-${stamp}@${domain}`;
  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const suspend = async (as: string, id: string) =>
    http().patch(`/users/${id}/suspend`).set('Authorization', await bearer(as));
  const legacySuspend = async (as: string, id: string) =>
    http().patch(`/identity/users/${id}`).set('Authorization', await bearer(as)).send({ status: 'SUSPENDED' });
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  const statusOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).status;

  type Assignment = { school: keyof typeof schools; role: string };
  async function user(key: string, assignments: Assignment[], data: { email?: string; passwordHash?: string } = {}) {
    const created = await prisma.user.create({
      data: { email: data.email ?? mail(key), fullName: key, status: 'ACTIVE', passwordHash: data.passwordHash },
    });
    for (const a of assignments) {
      const role = await prisma.role.findUniqueOrThrow({ where: { name: a.role } });
      await prisma.userAssignment.create({ data: { userId: created.id, schoolId: schools[a.school], roleId: role.id } });
    }
    ids[key] = created.id;
    return created.id;
  }

  // Google token verification is intercepted, like in google-login.e2e-spec.ts.
  const googleTokens = new Map<string, object>();
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url.includes('oauth2.googleapis.com/tokeninfo')) {
        const payload = googleTokens.get(new URL(url).searchParams.get('id_token') ?? '');
        return new Response(JSON.stringify(payload ?? { error_description: 'Invalid Value' }), {
          status: payload ? 200 : 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    sessions = app.get(SessionService);

    schools.A = (await prisma.school.create({ data: { name: `Test E2E Suspend School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E Suspend School B ${stamp}` } })).id;

    await user('AdminA', [{ school: 'A', role: 'SCHOOL_ADMIN' }]);
    await user('ManagerA', [{ school: 'A', role: 'CONTENT_MANAGER' }]);
    await user('StaffA', [{ school: 'A', role: 'STAFF' }]);
    await user('StudentA', [{ school: 'A', role: 'STUDENT' }]);
    await user('GuestA', [{ school: 'A', role: 'PARENT_GUEST' }]);
    await user('StudentB', [{ school: 'B', role: 'STUDENT' }]);

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E Suspend School' } } });
    await app.close();
  });

  describe('access', () => {
    it('requires a token', async () => {
      await http().patch(`/users/${ids.StudentA}/suspend`).expect(401);
    });

    it.each(['ManagerA', 'StaffA', 'StudentA', 'GuestA'])('rejects %s (no users:suspend permission)', async (key) => {
      const target = await user(`Target-${key}`, [{ school: 'A', role: 'STUDENT' }]);
      check(await suspend(ids[key], target), 403);
      expect(await statusOf(target)).toBe('ACTIVE');
    });

    it('rejects an invalid UUID with 400', async () => {
      check(await suspend(platformAdminId, 'not-a-uuid'), 400);
    });

    it('returns 404 for an unknown user', async () => {
      check(await suspend(platformAdminId, '00000000-0000-4000-8000-000000000000'), 404);
    });
  });

  describe('who can suspend whom', () => {
    it('a platform admin suspends a user of any school', async () => {
      const target = await user('PlatformTarget', [{ school: 'B', role: 'STAFF' }]);
      const res = check(await suspend(platformAdminId, target), 200);
      expect(res.body).toMatchObject({ id: target, status: 'SUSPENDED' });
    });

    it('a school admin suspends a user of their own school', async () => {
      const target = await user('OwnSchool', [{ school: 'A', role: 'STUDENT' }]);
      check(await suspend(ids.AdminA, target), 200);
      expect(await statusOf(target)).toBe('SUSPENDED');
    });

    it("a school admin cannot suspend another school's user", async () => {
      check(await suspend(ids.AdminA, ids.StudentB), 403);
      expect(await statusOf(ids.StudentB)).toBe('ACTIVE');
    });

    it('a school admin cannot suspend a user who is also in a school they do not administer', async () => {
      const target = await user('TwoSchools', [
        { school: 'A', role: 'STUDENT' },
        { school: 'B', role: 'STAFF' },
      ]);
      check(await suspend(ids.AdminA, target), 403);
      expect(await statusOf(target)).toBe('ACTIVE');
    });

    it('a school admin cannot suspend a user without any school', async () => {
      const target = await user('NoSchool', []);
      check(await suspend(ids.AdminA, target), 403);
      expect(await statusOf(target)).toBe('ACTIVE');
    });

    it('a school admin cannot suspend a platform admin', async () => {
      const target = await user('PlatformInA', [{ school: 'A', role: 'PLATFORM_ADMIN' }]);
      const res = check(await suspend(ids.AdminA, target), 403);
      expect(res.body.message).toBe('You cannot suspend a user with a higher-level role');
      expect(await statusOf(target)).toBe('ACTIVE');
    });

    it('a school admin can suspend a peer school admin of the same school', async () => {
      const target = await user('PeerAdminA', [{ school: 'A', role: 'SCHOOL_ADMIN' }]);
      check(await suspend(ids.AdminA, target), 200);
    });

    it('a platform admin can suspend another platform admin', async () => {
      const target = await user('OtherPlatform', [{ school: 'A', role: 'PLATFORM_ADMIN' }]);
      check(await suspend(platformAdminId, target), 200);
      expect(await statusOf(target)).toBe('SUSPENDED');
    });

    it.each(['AdminA', 'platform'])('%s cannot suspend themselves', async (key) => {
      const self = key === 'platform' ? platformAdminId : ids[key];
      const res = check(await suspend(self, self), 403);
      expect(res.body.message).toBe('You cannot suspend your own account');
      expect(await statusOf(self)).toBe('ACTIVE');
    });
  });

  describe('effects', () => {
    it('sets SUSPENDED, revokes every session and audits each one with reason user_suspended', async () => {
      const target = await user('WithSessions', [{ school: 'A', role: 'STUDENT' }]);
      const bystander = await user('Bystander', [{ school: 'A', role: 'STUDENT' }]);
      await sessions.createSession(target, SYSTEM_AUDIT_CONTEXT);
      await sessions.createSession(target, SYSTEM_AUDIT_CONTEXT);
      const other = await sessions.createSession(bystander, SYSTEM_AUDIT_CONTEXT);

      const res = check(await suspend(ids.AdminA, target), 200);

      expect(res.body.status).toBe('SUSPENDED');
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('setupToken');
      expect(await statusOf(target)).toBe('SUSPENDED');
      const rows = await prisma.session.findMany({ where: { userId: target } });
      expect(rows).toHaveLength(2);
      expect(rows.every((s) => s.revokedAt !== null)).toBe(true);

      const revoked = await prisma.auditEvent.findMany({
        where: { action: 'session_revoked', entityId: { in: rows.map((s) => s.id) } },
      });
      expect(revoked).toHaveLength(2);
      for (const event of revoked) {
        expect(event.details).toMatchObject({ ownerUserId: target, reason: 'user_suspended' });
        expect(event.actorId).toBe(ids.AdminA);
      }

      // Other users keep their sessions and their status.
      expect(await statusOf(bystander)).toBe('ACTIVE');
      expect(await prisma.session.count({ where: { userId: bystander, revokedAt: null } })).toBe(1);
      await http().post('/auth/refresh').send({ refreshToken: other.refreshToken }).expect(200);
    });

    it('suspending twice returns 200 both times without duplicate effects', async () => {
      const target = await user('Twice', [{ school: 'A', role: 'STUDENT' }]);
      await sessions.createSession(target, SYSTEM_AUDIT_CONTEXT);
      check(await suspend(ids.AdminA, target), 200);
      const afterFirst = await prisma.user.findUniqueOrThrow({ where: { id: target } });

      const res = check(await suspend(ids.AdminA, target), 200);

      expect(res.body.status).toBe('SUSPENDED');
      const afterSecond = await prisma.user.findUniqueOrThrow({ where: { id: target } });
      expect(afterSecond.updatedAt.getTime()).toBe(afterFirst.updatedAt.getTime());
      const session = await prisma.session.findFirstOrThrow({ where: { userId: target } });
      expect(await prisma.auditEvent.count({ where: { action: 'session_revoked', entityId: session.id } })).toBe(1);
    });

    it('an INVITED user can be suspended', async () => {
      const target = await user('Invited', [{ school: 'A', role: 'STUDENT' }]);
      await prisma.user.update({ where: { id: target }, data: { status: 'INVITED' } });
      check(await suspend(ids.AdminA, target), 200);
      expect(await statusOf(target)).toBe('SUSPENDED');
    });
  });

  describe('the suspended user is locked out', () => {
    it('their refresh token is rejected', async () => {
      const target = await user('Refresh', [{ school: 'A', role: 'STUDENT' }]);
      const pair = await sessions.createSession(target, SYSTEM_AUDIT_CONTEXT);
      check(await suspend(ids.AdminA, target), 200);
      await http().post('/auth/refresh').send({ refreshToken: pair.refreshToken }).expect(401);
    });

    it('their still-valid access token is rejected on the very next request', async () => {
      const target = await user('Access', [{ school: 'A', role: 'STUDENT' }]);
      const pair = await sessions.createSession(target, SYSTEM_AUDIT_CONTEXT);
      const sessionless = await bearer(target);
      await http().get('/auth/me').set('Authorization', `Bearer ${pair.accessToken}`).expect(200);

      check(await suspend(ids.AdminA, target), 200);

      // The session is revoked, and a token without a session still meets the status check.
      await http().get('/auth/me').set('Authorization', `Bearer ${pair.accessToken}`).expect(401);
      const res = await http().get('/auth/me').set('Authorization', sessionless).expect(403);
      expect(res.body.message).toBe('Account suspended');
    });

    it('admin login returns the generic 401', async () => {
      const password = 'SuspendMe123!';
      const passwordHash = await argon2.hash(password, { timeCost: 1, memoryCost: 1024, parallelism: 1 });
      const target = await user('LoginAdmin', [{ school: 'A', role: 'SCHOOL_ADMIN' }], { passwordHash });
      await http().post('/auth/admin/login').send({ email: mail('LoginAdmin'), password }).expect(200);

      check(await suspend(platformAdminId, target), 200);

      const res = await http().post('/auth/admin/login').send({ email: mail('LoginAdmin'), password }).expect(401);
      expect(res.body.message).toBe('Invalid credentials');
    });

    it('Google login is refused', async () => {
      const email = mail('Google', googleDomain);
      const target = await user('Google', [{ school: 'A', role: 'STUDENT' }], { email });
      const idToken = `suspend-google-${stamp}`;
      googleTokens.set(idToken, {
        sub: `sub-suspend-${stamp}`,
        email,
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: 'test-aud',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      await http().post('/auth/google').send({ idToken }).expect(200);

      check(await suspend(ids.AdminA, target), 200);

      const res = await http().post('/auth/google').send({ idToken }).expect(401);
      expect(res.body.message).toMatch(/authentication failed/i);
      const failure = await prisma.auditEvent.findFirst({
        where: { action: 'login_failure', entityId: target },
        orderBy: { seq: 'desc' },
      });
      expect(failure?.details).toMatchObject({ reason: 'account_suspended', method: 'google' });
    });
  });

  describe('legacy PATCH /identity/users/:id with status SUSPENDED', () => {
    it('applies the same rules: self, higher level, and all of the schools', async () => {
      const platformTarget = await user('LegacyPlatform', [{ school: 'A', role: 'PLATFORM_ADMIN' }]);
      const twoSchools = await user('LegacyTwoSchools', [
        { school: 'A', role: 'STUDENT' },
        { school: 'B', role: 'STAFF' },
      ]);

      check(await legacySuspend(ids.AdminA, ids.AdminA), 403);
      check(await legacySuspend(ids.AdminA, platformTarget), 403);
      check(await legacySuspend(ids.AdminA, twoSchools), 403);
      expect(await statusOf(ids.AdminA)).toBe('ACTIVE');
      expect(await statusOf(platformTarget)).toBe('ACTIVE');
      expect(await statusOf(twoSchools)).toBe('ACTIVE');
    });

    it('still suspends and revokes the sessions when allowed (used by the web app)', async () => {
      const target = await user('LegacyOk', [{ school: 'A', role: 'STUDENT' }]);
      await sessions.createSession(target, SYSTEM_AUDIT_CONTEXT);
      const res = check(await legacySuspend(ids.AdminA, target), 200);
      expect(res.body.status).toBe('SUSPENDED');
      expect(await prisma.session.count({ where: { userId: target, revokedAt: null } })).toBe(0);
    });
  });
});
