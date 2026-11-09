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

/** PATCH /users/:id/reactivate (#42): who can reactivate whom, sign-in restored, old sessions stay revoked. */
describe('User reactivation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let sessions: SessionService;
  const stamp = Date.now();
  const googleDomain = `reactivate-e2e-${stamp}.edu`;
  const schools = { A: '', B: '' };
  const ids: Record<string, string> = {};
  let platformAdminId: string;

  type Assignment = { school: keyof typeof schools; role: string };
  const mail = (key: string, domain = 'school.edu') => `e2e-reactivate-${key.toLowerCase()}-${stamp}@${domain}`;
  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const suspend = async (as: string, id: string) =>
    http().patch(`/users/${id}/suspend`).set('Authorization', await bearer(as));
  const reactivate = async (as: string, id: string) =>
    http().patch(`/users/${id}/reactivate`).set('Authorization', await bearer(as));
  const legacyReactivate = async (as: string, id: string) =>
    http().patch(`/identity/users/${id}`).set('Authorization', await bearer(as)).send({ status: 'ACTIVE' });
  /** A user suspended in the database, as #41 leaves them. */
  async function suspended(key: string, assignments: Assignment[], data: { email?: string; passwordHash?: string } = {}) {
    const id = await user(key, assignments, data);
    await prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' } });
    return id;
  }
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  const statusOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).status;

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

    schools.A = (await prisma.school.create({ data: { name: `Test E2E Reactivate School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E Reactivate School B ${stamp}` } })).id;

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
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E Reactivate School' } } });
    await app.close();
  });

  describe('access', () => {
    it('requires a token', async () => {
      await http().patch(`/users/${ids.StudentA}/reactivate`).expect(401);
    });

    it.each(['ManagerA', 'StaffA', 'StudentA', 'GuestA'])('rejects %s (no users:suspend permission)', async (key) => {
      const target = await suspended(`Target-${key}`, [{ school: 'A', role: 'STUDENT' }]);
      check(await reactivate(ids[key], target), 403);
      expect(await statusOf(target)).toBe('SUSPENDED');
    });

    it('rejects an invalid UUID with 400 and an unknown user with 404', async () => {
      check(await reactivate(platformAdminId, 'not-a-uuid'), 400);
      check(await reactivate(platformAdminId, '00000000-0000-4000-8000-000000000000'), 404);
    });
  });

  describe('who can reactivate whom', () => {
    it('a platform admin reactivates a user of any school', async () => {
      const target = await suspended('PlatformTarget', [{ school: 'B', role: 'STAFF' }]);
      const res = check(await reactivate(platformAdminId, target), 200);
      expect(res.body).toMatchObject({ id: target, status: 'ACTIVE' });
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('a school admin reactivates a user of their own school', async () => {
      const target = await suspended('OwnSchool', [{ school: 'A', role: 'STUDENT' }]);
      check(await reactivate(ids.AdminA, target), 200);
      expect(await statusOf(target)).toBe('ACTIVE');
    });

    it("a school admin cannot reactivate another school's user, or a user also in another school", async () => {
      const other = await suspended('OtherSchool', [{ school: 'B', role: 'STUDENT' }]);
      const both = await suspended('TwoSchools', [
        { school: 'A', role: 'STUDENT' },
        { school: 'B', role: 'STAFF' },
      ]);
      check(await reactivate(ids.AdminA, other), 403);
      check(await reactivate(ids.AdminA, both), 403);
      expect(await statusOf(other)).toBe('SUSPENDED');
      expect(await statusOf(both)).toBe('SUSPENDED');
    });

    it('a school admin cannot reactivate a platform admin; a platform admin can', async () => {
      const target = await suspended('PlatformInA', [{ school: 'A', role: 'PLATFORM_ADMIN' }]);
      const res = check(await reactivate(ids.AdminA, target), 403);
      expect(res.body.message).toBe('You cannot reactivate a user with a higher-level role');
      check(await reactivate(platformAdminId, target), 200);
    });

    it('nobody can reactivate themselves', async () => {
      const res = check(await reactivate(platformAdminId, platformAdminId), 403);
      expect(res.body.message).toBe('You cannot reactivate your own account');
    });
  });

  describe('effects', () => {
    it('is idempotent for an ACTIVE user', async () => {
      const target = await user('AlreadyActive', [{ school: 'A', role: 'STUDENT' }]);
      const before = await prisma.user.findUniqueOrThrow({ where: { id: target } });
      check(await reactivate(ids.AdminA, target), 200);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: target } });
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    });

    it('refuses an INVITED user with 409', async () => {
      const target = await user('Invited', [{ school: 'A', role: 'STUDENT' }]);
      await prisma.user.update({ where: { id: target }, data: { status: 'INVITED' } });
      check(await reactivate(ids.AdminA, target), 409);
      expect(await statusOf(target)).toBe('INVITED');
    });

    it('the sessions revoked by the suspension stay revoked', async () => {
      const target = await user('OldSession', [{ school: 'A', role: 'STUDENT' }]);
      const pair = await sessions.createSession(target, SYSTEM_AUDIT_CONTEXT);
      check(await suspend(ids.AdminA, target), 200);

      check(await reactivate(ids.AdminA, target), 200);

      expect(await prisma.session.count({ where: { userId: target, revokedAt: null } })).toBe(0);
      await http().post('/auth/refresh').send({ refreshToken: pair.refreshToken }).expect(401);
      await http().get('/auth/me').set('Authorization', `Bearer ${pair.accessToken}`).expect(401);
    });
  });

  describe('the reactivated user can sign in again', () => {
    it('with the admin login', async () => {
      const password = 'Reactivate123!';
      const passwordHash = await argon2.hash(password, { timeCost: 1, memoryCost: 1024, parallelism: 1 });
      const target = await user('LoginAdmin', [{ school: 'A', role: 'SCHOOL_ADMIN' }], { passwordHash });
      check(await suspend(platformAdminId, target), 200);
      await http().post('/auth/admin/login').send({ email: mail('LoginAdmin'), password }).expect(401);

      check(await reactivate(platformAdminId, target), 200);

      const res = await http().post('/auth/admin/login').send({ email: mail('LoginAdmin'), password }).expect(200);
      await http().get('/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    });

    it('with Google', async () => {
      const email = mail('Google', googleDomain);
      const target = await suspended('Google', [{ school: 'A', role: 'STUDENT' }], { email });
      const idToken = `reactivate-google-${stamp}`;
      googleTokens.set(idToken, {
        sub: `sub-reactivate-${stamp}`,
        email,
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: 'test-aud',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      await http().post('/auth/google').send({ idToken }).expect(401);

      check(await reactivate(ids.AdminA, target), 200);

      await http().post('/auth/google').send({ idToken }).expect(200);
    });
  });

  describe('legacy PATCH /identity/users/:id with status ACTIVE', () => {
    it('applies the same rules: self, higher level, and all of the schools', async () => {
      const platformTarget = await suspended('LegacyPlatform', [{ school: 'A', role: 'PLATFORM_ADMIN' }]);
      const both = await suspended('LegacyTwoSchools', [
        { school: 'A', role: 'STUDENT' },
        { school: 'B', role: 'STAFF' },
      ]);
      check(await legacyReactivate(ids.AdminA, ids.AdminA), 403);
      check(await legacyReactivate(ids.AdminA, platformTarget), 403);
      check(await legacyReactivate(ids.AdminA, both), 403);
      expect(await statusOf(platformTarget)).toBe('SUSPENDED');
      expect(await statusOf(both)).toBe('SUSPENDED');
    });

    it('still reactivates when allowed (used by the web app)', async () => {
      const target = await suspended('LegacyOk', [{ school: 'A', role: 'STUDENT' }]);
      const res = check(await legacyReactivate(ids.AdminA, target), 200);
      expect(res.body.status).toBe('ACTIVE');
    });
  });
});
