import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import bcrypt from 'bcryptjs';

/**
 * E2E tests for Issues #8 (admin login), #9 (user invitation), #10/#11 (Google login).
 *
 * These tests run against the real database configured in .env.
 * Issue #10 / #11 Google login tests mock the fetch call since we cannot call real Google
 * in a CI environment.
 */
describe('Auth & Invitation E2E (Issues #8, #9, #10, #11)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminToken: string;
  const stamp = Date.now();

  // Test data references
  let testSchoolId: string;
  let testSchoolIdWithDomain: string;
  let originalGoogleClientIds: string | undefined;

  beforeAll(async () => {
    originalGoogleClientIds = process.env.GOOGLE_CLIENT_IDS;
    process.env.GOOGLE_CLIENT_IDS = 'test-client-id';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // Get the seeded platform admin and issue a token for setup.
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
    });
    adminToken = (await app.get(TokenService).issueAccessToken(admin.id)).accessToken;

    // Create test schools.
    const schoolA = await prisma.school.create({ data: { name: `E2E Auth School A ${stamp}` } });
    testSchoolId = schoolA.id;

    const schoolB = await prisma.school.create({
      data: {
        name: `E2E Auth School B ${stamp}`,
        allowedDomains: `auth-e2e-${stamp}.edu`,
        domains: { create: [{ domain: `auth-e2e-${stamp}.edu` }] },
      },
    });
    testSchoolIdWithDomain = schoolB.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `auth-e2e-${stamp}` } } });
    await prisma.school.deleteMany({ where: { name: { contains: `E2E Auth School` } } });
    await app.close();
    if (originalGoogleClientIds === undefined) {
      delete process.env.GOOGLE_CLIENT_IDS;
    } else {
      process.env.GOOGLE_CLIENT_IDS = originalGoogleClientIds;
    }
  });

  // ── Issue #8: Admin login ─────────────────────────────────────────────────

  describe('POST /auth/admin/login (Issue #8)', () => {
    it('returns 400 for missing required fields', async () => {
      await request(app.getHttpServer()).post('/auth/admin/login').send({}).expect(400);
    });

    it('returns 400 for password shorter than 8 characters', async () => {
      await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ email: 'admin@test.com', password: 'short' })
        .expect(400);
    });

    it('returns 401 with a generic message for wrong credentials (no enumeration)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ email: 'nobody@wamdp.platform', password: 'wrongpassword!' })
        .expect(401);
      // Generic message — must NOT reveal that the user doesn't exist.
      expect(res.body.message).toMatch(/invalid credentials/i);
    });

    it('returns 401 for a correct email but wrong password', async () => {
      const adminEmail = process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform';
      await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ email: adminEmail, password: 'definitelywrongpassword123!' })
        .expect(401);
    });

    it('returns 200 with a token pair for valid admin credentials', async () => {
      const adminEmail = process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform';
      const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD || 'admin';
      const res = await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ email: adminEmail, password: adminPassword })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.tokenType).toBe('Bearer');
      expect(res.body.expiresIn).toBeGreaterThan(0);
      expect(res.body).toHaveProperty('sessionId');
    });

    it('creates a session record in the database on successful login', async () => {
      const adminEmail = process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform';
      const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD || 'admin';
      const res = await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ email: adminEmail, password: adminPassword })
        .expect(200);

      const session = await prisma.session.findUnique({ where: { id: res.body.sessionId } });
      expect(session).toBeDefined();
      expect(session?.refreshTokenHash).toBeDefined();
      // Refresh token hash must NOT be the raw token.
      expect(session?.refreshTokenHash).not.toBe(res.body.refreshToken);
    });

    it('returns 401 for a suspended admin account', async () => {
      // Create a suspended admin user.
      const hash = await bcrypt.hash('Passw0rd123!', 10);
      const suspendedAdmin = await prisma.user.create({
        data: {
          email: `auth-e2e-${stamp}-suspended@wamdp.platform`,
          fullName: 'Suspended Admin',
          authProvider: 'local',
          passwordHash: hash,
          status: 'SUSPENDED',
        },
      });
      const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'SCHOOL_ADMIN' } });
      await prisma.userAssignment.create({
        data: { userId: suspendedAdmin.id, roleId: adminRole.id, schoolId: testSchoolId },
      });

      await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ email: `auth-e2e-${stamp}-suspended@wamdp.platform`, password: 'Passw0rd123!' })
        .expect(401);
    });

    it('returns 401 for a student account trying to use admin login', async () => {
      const hash = await bcrypt.hash('Passw0rd123!', 10);
      const student = await prisma.user.create({
        data: {
          email: `auth-e2e-${stamp}-student@school.edu`,
          fullName: 'Student Test',
          authProvider: 'local',
          passwordHash: hash,
          status: 'ACTIVE',
        },
      });
      const studentRole = await prisma.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });
      await prisma.userAssignment.create({
        data: { userId: student.id, roleId: studentRole.id, schoolId: testSchoolId },
      });

      await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ email: `auth-e2e-${stamp}-student@school.edu`, password: 'Passw0rd123!' })
        .expect(401);
    });
  });

  // ── Issue #9: User invitation ─────────────────────────────────────────────

  describe('POST /identity/users/invite (Issue #9)', () => {
    it('returns 401 without authentication', async () => {
      await request(app.getHttpServer())
        .post('/identity/users/invite')
        .send({ email: 'new@school.edu', fullName: 'New User' })
        .expect(401);
    });

    it('returns 201 with INVITED status for a valid invitation', async () => {
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: `auth-e2e-${stamp}-invited@school.edu`,
          fullName: 'Invited User',
          schoolId: testSchoolId,
        })
        .expect(201);

      expect(res.body.status).toBe('INVITED');
      expect(res.body.email).toBe(`auth-e2e-${stamp}-invited@school.edu`);
      expect(res.body).not.toHaveProperty('passwordHash');

      // Verify user_assignment was created.
      const assignment = await prisma.userAssignment.findFirst({ where: { userId: res.body.id } });
      expect(assignment).toBeDefined();
      expect(assignment?.schoolId).toBe(testSchoolId);
    });

    it('returns 409 for a duplicate email', async () => {
      const email = `auth-e2e-${stamp}-dup@school.edu`;
      await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email, fullName: 'Dup User', schoolId: testSchoolId })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email, fullName: 'Dup User 2', schoolId: testSchoolId })
        .expect(409);

      expect(res.body.message).toMatch(/already exists/i);
    });

    it('returns 400 when email domain is not in school_domains', async () => {
      await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: `auth-e2e-${stamp}-wrong-domain@otherdomain.com`,
          fullName: 'Wrong Domain',
          schoolId: testSchoolIdWithDomain, // This school only allows auth-e2e-${stamp}.edu
        })
        .expect(400);
    });

    it('accepts an invitation when email domain matches school_domains', async () => {
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: `auth-e2e-${stamp}-correct@auth-e2e-${stamp}.edu`,
          fullName: 'Correct Domain User',
          schoolId: testSchoolIdWithDomain,
        })
        .expect(201);

      expect(res.body.status).toBe('INVITED');
    });

    it('accepts an invitation when school has no configured domains (no restriction)', async () => {
      // testSchoolId has no domains → any email domain is fine.
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: `auth-e2e-${stamp}-nodomain@randomdomain.xyz`,
          fullName: 'No Domain School User',
          schoolId: testSchoolId,
        })
        .expect(201);

      expect(res.body.status).toBe('INVITED');
    });
  });

  // ── Issues #10 + #11: Google login with domain restriction ────────────────
  // Note: actual Google token verification requires a real Google token.
  // The mock-backed tests below spy on global fetch to return a simulated Google
  // tokeninfo response so we can test the service logic end-to-end.

  describe('POST /auth/google (Issues #10 & #11)', () => {
    it('returns 400 for a missing idToken field', async () => {
      await request(app.getHttpServer()).post('/auth/google').send({}).expect(400);
    });

    it('returns 401 with a generic message for an invalid Google ID token', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: 'not.a.real.google.token' })
        .expect(401);
      // Generic message — must NOT reveal specifics.
      expect(res.body.message).toMatch(/authentication failed/i);
    });

    it('first-time Google login: transitions INVITED user to ACTIVE and links googleSub', async () => {
      // Create an INVITED user pre-assigned to a school with no domain restriction.
      const invitedUser = await prisma.user.create({
        data: {
          email: `auth-e2e-${stamp}-google-first@school.edu`,
          fullName: 'Google First Login',
          authProvider: 'google',
          status: 'INVITED',
        },
      });
      const studentRole = await prisma.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });
      await prisma.userAssignment.create({
        data: { userId: invitedUser.id, roleId: studentRole.id, schoolId: testSchoolId },
      });

      // Mock Google's tokeninfo endpoint to return a valid payload for this user.
      const googleSub = `google-sub-${stamp}-first`;
      const mockPayload = {
        sub: googleSub,
        email: `auth-e2e-${stamp}-google-first@school.edu`,
        email_verified: true,
        iss: 'accounts.google.com',
        aud: 'test-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockPayload,
        text: async () => JSON.stringify(mockPayload),
      } as Response);

      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: 'fake-first-login-token' })
        .expect(200);

      fetchSpy.mockRestore();

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.tokenType).toBe('Bearer');

      // Verify the user was activated and google_sub was linked.
      const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: invitedUser.id } });
      expect(updatedUser.status).toBe('ACTIVE');
      expect(updatedUser.googleSub).toBe(googleSub);
      expect(updatedUser.authProvider).toBe('google');

      // Verify a session was created.
      const session = await prisma.session.findUnique({ where: { id: res.body.sessionId } });
      expect(session).toBeDefined();
    });

    it('returning Google login via googleSub: returns tokens without re-linking', async () => {
      const googleSub = `google-sub-${stamp}-returning`;
      // Create a fully ACTIVE user already linked to a google_sub.
      const returningUser = await prisma.user.create({
        data: {
          email: `auth-e2e-${stamp}-google-return@school.edu`,
          fullName: 'Returning Google User',
          authProvider: 'google',
          googleSub,
          status: 'ACTIVE',
        },
      });
      const studentRole = await prisma.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });
      await prisma.userAssignment.create({
        data: { userId: returningUser.id, roleId: studentRole.id, schoolId: testSchoolId },
      });

      const mockPayload = {
        sub: googleSub, // Lookup by google_sub matches this user directly.
        email: 'completely-different@email.com', // Email doesn't matter for returning users.
        email_verified: true,
        iss: 'accounts.google.com',
        aud: 'test-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockPayload,
        text: async () => JSON.stringify(mockPayload),
      } as Response);

      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: 'fake-returning-token' })
        .expect(200);

      fetchSpy.mockRestore();

      expect(res.body).toHaveProperty('accessToken');
      // User's googleSub and status should remain unchanged.
      const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: returningUser.id } });
      expect(unchanged.googleSub).toBe(googleSub);
      expect(unchanged.status).toBe('ACTIVE');
    });

    it('rejects Google login when user\'s school has domains and email does NOT match — Issue #11', async () => {
      // testSchoolIdWithDomain restricts to auth-e2e-${stamp}.edu
      const invitedUser = await prisma.user.create({
        data: {
          email: `auth-e2e-${stamp}-domain-mismatch@gmail.com`,
          fullName: 'Domain Mismatch User',
          authProvider: 'google',
          status: 'INVITED',
        },
      });
      const studentRole = await prisma.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });
      await prisma.userAssignment.create({
        data: { userId: invitedUser.id, roleId: studentRole.id, schoolId: testSchoolIdWithDomain },
      });

      const mockPayload = {
        sub: `google-sub-${stamp}-domain-mismatch`,
        email: `auth-e2e-${stamp}-domain-mismatch@gmail.com`,
        email_verified: true,
        iss: 'accounts.google.com',
        aud: 'test-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockPayload,
        text: async () => JSON.stringify(mockPayload),
      } as Response);

      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: 'fake-domain-mismatch-token' })
        .expect(401);

      fetchSpy.mockRestore();

      // Must return a generic error, not a specific domain message.
      expect(res.body.message).toMatch(/authentication failed/i);

      // User must NOT have been activated (domain check must happen before ACTIVE transition).
      const user = await prisma.user.findUniqueOrThrow({ where: { id: invitedUser.id } });
      expect(user.status).toBe('INVITED');
      expect(user.googleSub).toBeNull();
    });

    it('rejects Google login for an admin account (SCHOOL_ADMIN role) — Issues #10/#11', async () => {
      // Create a SCHOOL_ADMIN user (even without a passwordHash — role check must catch them).
      const adminUser = await prisma.user.create({
        data: {
          email: `auth-e2e-${stamp}-google-admin@school.edu`,
          fullName: 'Admin No Password',
          authProvider: 'local',
          passwordHash: null,
          status: 'ACTIVE',
        },
      });
      const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'SCHOOL_ADMIN' } });
      await prisma.userAssignment.create({
        data: { userId: adminUser.id, roleId: adminRole.id, schoolId: testSchoolId },
      });

      const mockPayload = {
        sub: `google-sub-${stamp}-admin`,
        email: `auth-e2e-${stamp}-google-admin@school.edu`,
        email_verified: true,
        iss: 'accounts.google.com',
        aud: 'test-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockPayload,
        text: async () => JSON.stringify(mockPayload),
      } as Response);

      await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: 'fake-admin-google-token' })
        .expect(401);

      fetchSpy.mockRestore();
    });
  });
});
