import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * E2E test suite for Issue #26:
 * [BACKEND][AUTH] Invite a user as Admin & Set the first password of an invited admin.
 *
 * Acceptance Criteria verified:
 *  - Generates a single-use, expiring setup token when an admin is invited.
 *  - Endpoint POST /auth/password/setup (token + new password).
 *  - Password rules (minimum length 8) and argon2 hashing.
 *  - Sets the user status to ACTIVE after setup.
 *  - The setup token works only once and expires.
 *  - An expired or already used token is rejected.
 *  - The password is never returned or logged.
 *  - The newly activated admin can immediately log in via POST /auth/admin/login.
 */
describe('Admin Password Setup E2E (Issue #26)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;

  const stamp = Date.now();
  let schoolId: string;
  let platformAdminToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    // Platform admin for inviting users
    const platformAdmin = await prisma.user.findUniqueOrThrow({
      where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
    });
    platformAdminToken = (await tokens.issueAccessToken(platformAdmin.id)).accessToken;

    await prisma.role.findUniqueOrThrow({ where: { name: 'SCHOOL_ADMIN' } });

    // Test school
    const school = await prisma.school.create({
      data: {
        name: `E2E Setup School ${stamp}`,
        status: 'active',
        allowedDomains: '',
      },
    });
    schoolId = school.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { contains: `e2e-setup-${stamp}` } },
          { fullName: { contains: `Setup Admin ${stamp}` } },
        ],
      },
    });
    await prisma.school.deleteMany({
      where: {
        name: { contains: `E2E Setup School ${stamp}` },
      },
    });
    await app.close();
  });

  describe('Admin Invitation with Setup Token Generation', () => {
    it('generates a 64-char single-use setup token when inviting a SCHOOL_ADMIN', async () => {
      const email = `e2e-setup-${stamp}-school-admin@school.edu`;
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({
          email,
          fullName: `Setup Admin ${stamp}`,
          schoolId,
          role: 'SCHOOL_ADMIN',
        })
        .expect(201);

      expect(res.body.email).toBe(email);
      expect(res.body.status).toBe('INVITED');
      expect(res.body.authProvider).toBe('local');
      expect(res.body.setupToken).toBeDefined();
      expect(res.body.setupToken).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.setupTokenExpiresAt).toBeDefined();

      // Verify token record in database
      const dbToken = await prisma.passwordSetupToken.findFirst({
        where: { userId: res.body.id },
      });
      expect(dbToken).toBeDefined();
      expect(dbToken?.usedAt).toBeNull();
      expect(new Date(dbToken!.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('does not generate a setup token when inviting a non-admin STUDENT', async () => {
      const email = `e2e-setup-${stamp}-student@school.edu`;
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({
          email,
          fullName: `Setup Student ${stamp}`,
          schoolId,
          role: 'STUDENT',
        })
        .expect(201);

      expect(res.body.email).toBe(email);
      expect(res.body.authProvider).toBe('google');
      expect(res.body.setupToken).toBeUndefined();
    });
  });

  describe('POST /auth/password/setup - Validation & Error Handling', () => {
    it('rejects missing or empty token with 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .post('/auth/password/setup')
        .send({
          token: '',
          newPassword: 'StrongPassword123!',
        })
        .expect(400);
    });

    it('rejects invalid or unknown token with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/password/setup')
        .send({
          token: '0000000000000000000000000000000000000000000000000000000000000000',
          newPassword: 'StrongPassword123!',
        })
        .expect(400);

      expect(res.body.message).toContain('Invalid or expired setup token');
    });

    it('rejects password shorter than 8 characters with 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .post('/auth/password/setup')
        .send({
          token: 'some-random-token',
          newPassword: 'short',
        })
        .expect(400);
    });

    it('rejects setup when user account is SUSPENDED with 403 Forbidden', async () => {
      // Invite an admin
      const email = `e2e-setup-${stamp}-suspended@school.edu`;
      const inviteRes = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({
          email,
          fullName: `Suspended Setup Admin ${stamp}`,
          schoolId,
          role: 'SCHOOL_ADMIN',
        })
        .expect(201);

      const setupToken = inviteRes.body.setupToken;

      // Suspend user in DB
      await prisma.user.update({
        where: { id: inviteRes.body.id },
        data: { status: 'SUSPENDED' },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/password/setup')
        .send({
          token: setupToken,
          newPassword: 'ValidPassword123!',
        })
        .expect(403);

      expect(res.body.message).toContain('Account is suspended');
    });
  });

  describe('POST /auth/password/setup - Successful Flow & Login Loop', () => {
    let setupToken: string;
    let adminEmail: string;
    let adminUserId: string;
    const newPassword = 'MySecretArgon2Password2026!';

    beforeAll(async () => {
      adminEmail = `e2e-setup-${stamp}-success@school.edu`;
      const inviteRes = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({
          email: adminEmail,
          fullName: `Success Admin ${stamp}`,
          schoolId,
          role: 'SCHOOL_ADMIN',
        })
        .expect(201);

      setupToken = inviteRes.body.setupToken;
      adminUserId = inviteRes.body.id;
    });

    it('sets initial password with argon2, activates account, and never returns password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/password/setup')
        .send({
          token: setupToken,
          newPassword,
        })
        .expect(200);

      // Verify response does not leak password or hash
      expect(res.body.message).toContain('Password set up successfully');
      expect(res.body.password).toBeUndefined();
      expect(res.body.passwordHash).toBeUndefined();

      // Verify user in DB: status ACTIVE, passwordHash begins with $argon2id$
      const userInDb = await prisma.user.findUniqueOrThrow({
        where: { id: adminUserId },
      });
      expect(userInDb.status).toBe('ACTIVE');
      expect(userInDb.authProvider).toBe('local');
      expect(userInDb.passwordHash).toMatch(/^\$argon2id\$/);

      // Verify token in DB: usedAt is populated
      const tokenInDb = await prisma.passwordSetupToken.findFirstOrThrow({
        where: { userId: adminUserId },
      });
      expect(tokenInDb.usedAt).not.toBeNull();
    });

    it('rejects using the setup token a second time (single-use criterion)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/password/setup')
        .send({
          token: setupToken,
          newPassword: 'AnotherPassword123!',
        })
        .expect(400);

      expect(res.body.message).toContain('Setup token has already been used');
    });

    it('allows newly activated admin to log in via POST /auth/admin/login with new password', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({
          email: adminEmail,
          password: newPassword,
        })
        .expect(200);

      expect(loginRes.body.accessToken).toBeDefined();
      expect(loginRes.body.refreshToken).toBeDefined();

      // Verify access token works on protected endpoints
      const meRes = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
        .expect(200);

      expect(meRes.body.id).toBe(adminUserId);
      expect(meRes.body.email).toBe(adminEmail);
      expect(meRes.body.status).toBe('ACTIVE');
      expect(meRes.body.role).toBe('SCHOOL_ADMIN');
    });

    it('rejects login with wrong password with generic 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({
          email: adminEmail,
          password: 'IncorrectPassword999!',
        })
        .expect(401);
    });

    it('rejects an expired setup token with 400 Bad Request', async () => {
      // Invite another admin
      const email = `e2e-setup-${stamp}-expired@school.edu`;
      const inviteRes = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({
          email,
          fullName: `Expired Admin ${stamp}`,
          schoolId,
          role: 'SCHOOL_ADMIN',
        })
        .expect(201);

      const expiredToken = inviteRes.body.setupToken;

      // Force token expiration in DB to the past
      await prisma.passwordSetupToken.updateMany({
        where: { userId: inviteRes.body.id },
        data: { expiresAt: new Date(Date.now() - 3600_000) },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/password/setup')
        .send({
          token: expiredToken,
          newPassword: 'ValidPassword123!',
        })
        .expect(400);

      expect(res.body.message).toContain('Setup token has expired');
    });

    it('rejects password longer than 128 characters with 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .post('/auth/password/setup')
        .send({
          token: 'some-random-token',
          newPassword: 'A'.repeat(129),
        })
        .expect(400);
    });

    it('enforces atomic single-use under concurrent setup requests (race condition protection)', async () => {
      const email = `e2e-setup-${stamp}-concurrent@school.edu`;
      const inviteRes = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({
          email,
          fullName: `Concurrent Admin ${stamp}`,
          schoolId,
          role: 'SCHOOL_ADMIN',
        })
        .expect(201);

      const token = inviteRes.body.setupToken;

      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post('/auth/password/setup')
          .send({ token, newPassword: 'ConcurrentPassword123!' }),
        request(app.getHttpServer())
          .post('/auth/password/setup')
          .send({ token, newPassword: 'ConcurrentPassword123!' }),
      ]);

      const statuses = [res1.status, res2.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 400]);
    });
  });
});

