import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * E2E tests for Issue #8: Administrator login (email + password).
 *
 * Acceptance criteria tested:
 *  - 400 validation error on malformed or incomplete payload.
 *  - Uniform generic 401 on bad password, missing email, non-admin role, or suspended status.
 *  - No passwords returned in plaintext or leaked in responses.
 *  - Passwords hashed in database.
 *  - 200 OK returns valid access and refresh token pair on correct credentials.
 *  - First login of an INVITED admin transitions their status to ACTIVE (no JwtAuthGuard lockout).
 *  - Non-admin users (e.g. STUDENT) cannot authenticate via this endpoint.
 *  - Sessions table stores hashed refresh tokens.
 *  - Returned access token works on protected endpoints (e.g. GET /auth/me).
 *  - Returned refresh token works on POST /auth/refresh.
 */
describe('Admin Login E2E (Issue #8)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const stamp = Date.now();
  let schoolId: string;
  let schoolAdminRoleId: string;
  let studentRoleId: string;

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

    // Resolve roles
    const sRole = await prisma.role.findUniqueOrThrow({
      where: { name: 'SCHOOL_ADMIN' },
    });
    const stRole = await prisma.role.findUniqueOrThrow({
      where: { name: 'STUDENT' },
    });
    schoolAdminRoleId = sRole.id;
    studentRoleId = stRole.id;

    // Create a temporary school
    const school = await prisma.school.create({
      data: {
        name: `Admin Login E2E School ${stamp}`,
        allowedDomains: `admin-e2e-${stamp}.edu`,
      },
    });
    schoolId = school.id;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({
      where: { user: { email: { contains: `admin-e2e-${stamp}` } } },
    });
    await prisma.userAssignment.deleteMany({
      where: { user: { email: { contains: `admin-e2e-${stamp}` } } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: `admin-e2e-${stamp}` } },
    });
    await prisma.school.deleteMany({
      where: { id: schoolId },
    });
    await app.close();
  });

  describe('Validation (400 Bad Request)', () => {
    it('rejects empty request body', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({})
        .expect(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/email/i),
          expect.stringMatching(/password/i),
        ]),
      );
    });

    it('rejects invalid email format', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ email: 'not-an-email', password: 'validPassword123!' })
        .expect(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/email must be an email/i),
        ]),
      );
    });

    it('rejects password shorter than 8 characters', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ email: 'admin@school.edu', password: 'short' })
        .expect(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/password must be longer than or equal to 8/i),
        ]),
      );
    });
  });

  describe('Security & Authentication Failure Cases (Generic 401)', () => {
    it('returns generic 401 for non-existent email without leaking user existence', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({
          email: `nonexistent-${stamp}@wamdp.platform`,
          password: 'somePassword123!',
        })
        .expect(401);
      expect(res.body.message).toBe('Invalid credentials');
    });

    it('returns generic 401 for existing admin with wrong password', async () => {
      const email = `admin-e2e-${stamp}-wrongpass@school.edu`;
      const passwordHash = await bcrypt.hash('CorrectPass123!', 10);
      const user = await prisma.user.create({
        data: {
          email,
          fullName: 'Test Admin WrongPass',
          authProvider: 'local',
          passwordHash,
          status: 'ACTIVE',
        },
      });
      await prisma.userAssignment.create({
        data: { userId: user.id, roleId: schoolAdminRoleId, schoolId },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ email, password: 'IncorrectPassword999!' })
        .expect(401);
      expect(res.body.message).toBe('Invalid credentials');
    });

    it('returns generic 401 when account is SUSPENDED', async () => {
      const email = `admin-e2e-${stamp}-suspended@school.edu`;
      const password = 'SuspendedPass123!';
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: {
          email,
          fullName: 'Suspended Admin',
          authProvider: 'local',
          passwordHash,
          status: 'SUSPENDED',
        },
      });
      await prisma.userAssignment.create({
        data: { userId: user.id, roleId: schoolAdminRoleId, schoolId },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ email, password })
        .expect(401);
      expect(res.body.message).toBe('Invalid credentials');
    });

    it('returns generic 401 when user is not an administrator (e.g. STUDENT)', async () => {
      const email = `admin-e2e-${stamp}-student@school.edu`;
      const password = 'StudentPass123!';
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: {
          email,
          fullName: 'Student User',
          authProvider: 'local',
          passwordHash,
          status: 'ACTIVE',
        },
      });
      await prisma.userAssignment.create({
        data: { userId: user.id, roleId: studentRoleId, schoolId },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ email, password })
        .expect(401);
      expect(res.body.message).toBe('Invalid credentials');
    });

    it('returns generic 401 when account authProvider is not local (e.g. google)', async () => {
      const email = `admin-e2e-${stamp}-google@school.edu`;
      const user = await prisma.user.create({
        data: {
          email,
          fullName: 'Google User',
          authProvider: 'google',
          passwordHash: null,
          status: 'ACTIVE',
        },
      });
      await prisma.userAssignment.create({
        data: { userId: user.id, roleId: schoolAdminRoleId, schoolId },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ email, password: 'AnyPassword123!' })
        .expect(401);
      expect(res.body.message).toBe('Invalid credentials');
    });
  });

  describe('Successful Authentication & Activation', () => {
    it('authenticates active platform admin and returns usable token pair and session', async () => {
      const adminEmail =
        process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform';
      const adminPassword =
        process.env.PLATFORM_ADMIN_PASSWORD || 'wamdp_admin_2026!';

      const loginRes = await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ email: adminEmail, password: adminPassword })
        .expect(200);

      expect(loginRes.body).toHaveProperty('accessToken');
      expect(loginRes.body).toHaveProperty('refreshToken');
      expect(loginRes.body.tokenType).toBe('Bearer');
      expect(loginRes.body.expiresIn).toBeGreaterThan(0);
      expect(loginRes.body).toHaveProperty('sessionId');
      expect(loginRes.body).toHaveProperty('refreshExpiresAt');

      // Password should never be returned
      expect(loginRes.body).not.toHaveProperty('password');
      expect(loginRes.body).not.toHaveProperty('passwordHash');

      const sessionId = loginRes.body.sessionId;
      const accessToken = loginRes.body.accessToken;
      const refreshToken = loginRes.body.refreshToken;

      // Verify session stored with hashed refresh token
      const sessionInDb = await prisma.session.findUnique({
        where: { id: sessionId },
      });
      expect(sessionInDb).toBeDefined();
      expect(sessionInDb?.refreshTokenHash).toBeDefined();
      expect(sessionInDb?.refreshTokenHash).toHaveLength(64); // SHA-256 hex length

      // Verify access token works on GET /auth/me
      const meRes = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(meRes.body.email).toBe(adminEmail);
      expect(meRes.body.role).toBe('PLATFORM_ADMIN');
      expect(meRes.body.status).toBe('ACTIVE');

      // Verify refresh rotation works with the returned refresh token
      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);
      expect(refreshRes.body).toHaveProperty('accessToken');
      expect(refreshRes.body).toHaveProperty('refreshToken');
      expect(refreshRes.body.refreshToken).not.toBe(refreshToken);
    });

    it('activates an INVITED school admin on first login so JwtAuthGuard does not block them', async () => {
      const email = `admin-e2e-${stamp}-invited@school.edu`;
      const password = 'FirstLoginPass123!';
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: {
          email,
          fullName: 'Invited School Admin',
          authProvider: 'local',
          passwordHash,
          status: 'INVITED', // Start as INVITED
        },
      });
      await prisma.userAssignment.create({
        data: { userId: user.id, roleId: schoolAdminRoleId, schoolId },
      });

      // 1. Admin logs in with valid credentials
      const loginRes = await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({ email, password })
        .expect(200);

      const accessToken = loginRes.body.accessToken;

      // 2. Verify status transitioned to ACTIVE in the database
      const updatedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(updatedUser.status).toBe('ACTIVE');

      // 3. Verify user can immediately make authenticated requests with access token without 403 lockout
      const meRes = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(meRes.body.id).toBe(user.id);
      expect(meRes.body.status).toBe('ACTIVE');
      expect(meRes.body.role).toBe('SCHOOL_ADMIN');
    });

    it('handles mixed-case and whitespace-padded email gracefully', async () => {
      const email = `admin-e2e-${stamp}-case@school.edu`;
      const password = 'MixedCasePass123!';
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: {
          email,
          fullName: 'Case Sensitive Admin',
          authProvider: 'local',
          passwordHash,
          status: 'ACTIVE',
        },
      });
      await prisma.userAssignment.create({
        data: { userId: user.id, roleId: schoolAdminRoleId, schoolId },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({
          email: `   ${email.toUpperCase()}   `,
          password,
        })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
    });
  });
});
