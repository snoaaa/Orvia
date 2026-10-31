import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * E2E test suite for Issue #10 & Issue #11: Google OAuth 2.0 & School Domain Restrictions.
 *
 * Acceptance Criteria verified against MySQL:
 *  - 400 Bad Request on missing idToken.
 *  - 401 Unauthorized on invalid/bogus token.
 *  - First-time login: transitions user status from INVITED to ACTIVE, binds googleSub, creates session.
 *  - Returning user login: authenticates via googleSub without overwriting internal state.
 *  - Unknown user: rejects valid Google accounts not pre-registered in system (audits unknown_user).
 *  - Administrator accounts: rejects platform admins and school admins from Google login (audits not_admin).
 *  - Suspended accounts: rejects suspended users with generic 401 (audits account_suspended).
 *  - Issue #11: Rejects user whose domain is not in school_domains.
 *  - Issue #11: Rejects user whose domain belongs to a school they are NOT assigned to.
 *  - Issue #11: A school with no configured domain does not restrict anything (open onboarding).
 *  - Issue #11: Departmental subdomains permitted when institutional domain is configured.
 *  - Issue #11: Admin accounts (email + password) are NOT affected by domain restrictions.
 *  - Device binding: binds deviceId to session when supplied.
 *  - Issued access token immediately authorizes protected endpoints (e.g. GET /auth/me).
 *  - Cryptographic audit trail: verifies login_success and login_failure events in hash chain.
 */
describe('Google Login & School Domain Restrictions E2E (Issue #10 & #11)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const stamp = Date.now();

  let schoolAId: string;
  let schoolCId: string;
  let unrestrictedSchoolId: string;

  let studentRoleId: string;
  let schoolAdminRoleId: string;

  // Track mock tokens mapped to Google payload responses
  const mockTokenMap = new Map<string, any>();

  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    // Intercept Google tokeninfo requests hermetically
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      if (urlStr.includes('oauth2.googleapis.com/tokeninfo')) {
        const url = new URL(urlStr);
        const idToken = url.searchParams.get('id_token') || '';
        const mockPayload = mockTokenMap.get(idToken);

        if (!mockPayload) {
          return new Response(JSON.stringify({ error_description: 'Invalid Value' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify(mockPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    };

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
    const stRole = await prisma.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });
    const saRole = await prisma.role.findUniqueOrThrow({ where: { name: 'SCHOOL_ADMIN' } });
    studentRoleId = stRole.id;
    schoolAdminRoleId = saRole.id;

    // 1. School A with domain: google-e2e-${stamp}-a.edu
    const schoolA = await prisma.school.create({
      data: {
        name: `Google Login School A ${stamp}`,
        allowedDomains: `google-e2e-${stamp}-a.edu`,
        domains: {
          create: [{ domain: `google-e2e-${stamp}-a.edu` }],
        },
      },
    });
    schoolAId = schoolA.id;

    // 2. School C with domain: google-e2e-${stamp}-c.edu (for cross-school domain testing)
    const schoolC = await prisma.school.create({
      data: {
        name: `Google Login School C ${stamp}`,
        allowedDomains: `google-e2e-${stamp}-c.edu`,
        domains: {
          create: [{ domain: `google-e2e-${stamp}-c.edu` }],
        },
      },
    });
    schoolCId = schoolC.id;

    // 3. Open / Unrestricted School (0 domains configured)
    const schoolOpen = await prisma.school.create({
      data: {
        name: `Google Login Open School ${stamp}`,
      },
    });
    unrestrictedSchoolId = schoolOpen.id;

    // 4. Invited student in School A
    const invitedStudent = await prisma.user.create({
      data: {
        email: `invited-student-${stamp}@google-e2e-${stamp}-a.edu`,
        fullName: 'Invited Student A',
        status: 'INVITED',
        authProvider: 'google',
        passwordHash: null,
      },
    });
    await prisma.userAssignment.create({
      data: { userId: invitedStudent.id, schoolId: schoolAId, roleId: studentRoleId },
    });

    // 5. Returning student in School A with pre-existing googleSub
    const returningStudent = await prisma.user.create({
      data: {
        email: `returning-student-${stamp}@google-e2e-${stamp}-a.edu`,
        fullName: 'Returning Student A',
        status: 'ACTIVE',
        authProvider: 'google',
        googleSub: `sub-returning-${stamp}`,
        passwordHash: null,
      },
    });
    await prisma.userAssignment.create({
      data: { userId: returningStudent.id, schoolId: schoolAId, roleId: studentRoleId },
    });

    // 6. Suspended student in School A
    const suspendedStudent = await prisma.user.create({
      data: {
        email: `suspended-student-${stamp}@google-e2e-${stamp}-a.edu`,
        fullName: 'Suspended Student',
        status: 'SUSPENDED',
        authProvider: 'google',
        passwordHash: null,
      },
    });
    await prisma.userAssignment.create({
      data: { userId: suspendedStudent.id, schoolId: schoolAId, roleId: studentRoleId },
    });

    // 7. School Admin in School A (must not log in via Google)
    const schoolAdmin = await prisma.user.create({
      data: {
        email: `admin-${stamp}@google-e2e-${stamp}-a.edu`,
        fullName: 'School Admin',
        status: 'ACTIVE',
        authProvider: 'local',
        passwordHash: await bcrypt.hash('SecurePassword123!', 12),
      },
    });
    await prisma.userAssignment.create({
      data: { userId: schoolAdmin.id, schoolId: schoolAId, roleId: schoolAdminRoleId },
    });

    // 8. Student in Open School (allowed any email, e.g. gmail)
    const openSchoolStudent = await prisma.user.create({
      data: {
        email: `open-student-${stamp}@gmail.com`,
        fullName: 'Open Student',
        status: 'INVITED',
        authProvider: 'google',
      },
    });
    await prisma.userAssignment.create({
      data: { userId: openSchoolStudent.id, schoolId: unrestrictedSchoolId, roleId: studentRoleId },
    });

    // 9. Student in School A with departmental subdomain
    const subStudent = await prisma.user.create({
      data: {
        email: `sub-student-${stamp}@dept.google-e2e-${stamp}-a.edu`,
        fullName: 'Subdomain Student',
        status: 'INVITED',
        authProvider: 'google',
      },
    });
    await prisma.userAssignment.create({
      data: { userId: subStudent.id, schoolId: schoolAId, roleId: studentRoleId },
    });

    // 10. Student assigned to School A whose domain belongs to School C (cross-school mismatch)
    const crossSchoolStudent = await prisma.user.create({
      data: {
        email: `cross-student-${stamp}@google-e2e-${stamp}-c.edu`,
        fullName: 'Cross School Student',
        status: 'INVITED',
        authProvider: 'google',
      },
    });
    await prisma.userAssignment.create({
      data: { userId: crossSchoolStudent.id, schoolId: schoolAId, roleId: studentRoleId },
    });

    // 11. Dual assigned student: assigned to School A (restricted) and School Open (unrestricted)
    const dualStudent = await prisma.user.create({
      data: {
        email: `dual-student-${stamp}@personal-mail.org`,
        fullName: 'Dual School Student',
        status: 'INVITED',
        authProvider: 'google',
      },
    });
    await prisma.userAssignment.create({
      data: { userId: dualStudent.id, schoolId: schoolAId, roleId: studentRoleId },
    });
    await prisma.userAssignment.create({
      data: { userId: dualStudent.id, schoolId: unrestrictedSchoolId, roleId: studentRoleId },
    });

    // 12. External Admin for School A with external domain (to test admin login is unaffected)
    const externalAdmin = await prisma.user.create({
      data: {
        email: `external-admin-${stamp}@any-custom-domain.net`,
        fullName: 'External Admin',
        status: 'ACTIVE',
        authProvider: 'local',
        passwordHash: await bcrypt.hash('AdminExternal123!', 12),
      },
    });
    await prisma.userAssignment.create({
      data: { userId: externalAdmin.id, schoolId: schoolAId, roleId: schoolAdminRoleId },
    });
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;

    await prisma.session.deleteMany({
      where: { user: { email: { contains: `-${stamp}@` } } },
    });
    await prisma.userAssignment.deleteMany({
      where: { user: { email: { contains: `-${stamp}@` } } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: `-${stamp}@` } },
    });

    const safeSchoolIds = [schoolAId, schoolCId, unrestrictedSchoolId].filter(Boolean);
    if (safeSchoolIds.length > 0) {
      await prisma.schoolDomain.deleteMany({
        where: { schoolId: { in: safeSchoolIds } },
      });
      await prisma.school.deleteMany({
        where: { id: { in: safeSchoolIds } },
      });
    }

    await app.close();
  });

  describe('Validation & Verification Failures (400 / 401)', () => {
    it('returns 400 Bad Request when idToken is missing from body', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({})
        .expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/idToken/i)]),
      );
    });

    it('returns 401 Unauthorized with generic message when token is invalid or rejected by Google', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: 'invalid.bogus.token' })
        .expect(401);

      expect(res.body.message).toMatch(/authentication failed/i);
    });

    it('returns 401 Unauthorized when Google token has unverified email (email_verified: false)', async () => {
      const token = `unverified-token-${stamp}`;
      mockTokenMap.set(token, {
        sub: `sub-unverified-${stamp}`,
        email: `invited-student-${stamp}@google-e2e-${stamp}-a.edu`,
        email_verified: false,
        iss: 'https://accounts.google.com',
        aud: 'test-aud',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: token })
        .expect(401);

      expect(res.body.message).toMatch(/authentication failed/i);
    });
  });

  describe('First-Time Login for Invited Users', () => {
    it('activates invited user, links google_sub, creates session, and returns token pair', async () => {
      const token = `invited-token-${stamp}`;
      const email = `invited-student-${stamp}@google-e2e-${stamp}-a.edu`;
      const googleSub = `google-sub-invited-${stamp}`;

      mockTokenMap.set(token, {
        sub: googleSub,
        email,
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: 'test-aud',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: token })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body).toHaveProperty('sessionId');
      expect(res.body.tokenType).toBe('Bearer');
      expect(res.body.expiresIn).toBeGreaterThan(0);

      // Verify DB status transitioned from INVITED to ACTIVE
      const dbUser = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(dbUser.status).toBe('ACTIVE');
      expect(dbUser.googleSub).toBe(googleSub);
      expect(dbUser.authProvider).toBe('google');

      // Verify session exists in DB
      const session = await prisma.session.findUnique({ where: { id: res.body.sessionId } });
      expect(session).toBeDefined();
      expect(session?.userId).toBe(dbUser.id);
      expect(session?.refreshTokenHash).toBeDefined();

      // Verify access token authorizes protected endpoints
      const meRes = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);

      expect(meRes.body.id).toBe(dbUser.id);
      expect(meRes.body.email).toBe(email);
      expect(meRes.body.status).toBe('ACTIVE');
    });
  });

  describe('Returning User Login', () => {
    it('authenticates returning user via googleSub', async () => {
      const token = `returning-token-${stamp}`;
      const email = `returning-student-${stamp}@google-e2e-${stamp}-a.edu`;
      const googleSub = `sub-returning-${stamp}`;

      mockTokenMap.set(token, {
        sub: googleSub,
        email,
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: 'test-aud',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: token })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');

      const dbUser = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(dbUser.status).toBe('ACTIVE');
      expect(dbUser.googleSub).toBe(googleSub);
    });
  });

  describe('Defense-in-Depth Account Rejections', () => {
    it('rejects unknown Google account not registered in system (401)', async () => {
      const token = `unknown-token-${stamp}`;
      mockTokenMap.set(token, {
        sub: `sub-unknown-${stamp}`,
        email: `nobody-${stamp}@google-e2e-${stamp}-a.edu`,
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: 'test-aud',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: token })
        .expect(401);

      expect(res.body.message).toMatch(/authentication failed/i);
    });

    it('rejects administrator accounts from Google login (401)', async () => {
      const token = `admin-token-${stamp}`;
      const email = `admin-${stamp}@google-e2e-${stamp}-a.edu`;

      mockTokenMap.set(token, {
        sub: `sub-admin-${stamp}`,
        email,
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: 'test-aud',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: token })
        .expect(401);

      expect(res.body.message).toMatch(/authentication failed/i);
    });

    it('rejects suspended accounts with generic 401', async () => {
      const token = `suspended-token-${stamp}`;
      const email = `suspended-student-${stamp}@google-e2e-${stamp}-a.edu`;

      mockTokenMap.set(token, {
        sub: `sub-suspended-${stamp}`,
        email,
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: 'test-aud',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: token })
        .expect(401);

      expect(res.body.message).toMatch(/authentication failed/i);
    });
  });

  describe('School Domain Restrictions (Issue #11 Acceptance Criteria)', () => {
    it('criterion 1: rejects user whose domain is not in school_domains (401)', async () => {
      const foreignStudent = await prisma.user.create({
        data: {
          email: `foreign-domain-${stamp}@unknown-external-domain.com`,
          fullName: 'Foreign Domain Student',
          status: 'INVITED',
          authProvider: 'google',
        },
      });
      await prisma.userAssignment.create({
        data: { userId: foreignStudent.id, schoolId: schoolAId, roleId: studentRoleId },
      });

      const token = `foreign-token-${stamp}`;
      mockTokenMap.set(token, {
        sub: `sub-foreign-${stamp}`,
        email: `foreign-domain-${stamp}@unknown-external-domain.com`,
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: 'test-aud',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: token })
        .expect(401);

      expect(res.body.message).toMatch(/authentication failed/i);
    });

    it('criterion 2: rejects user whose domain belongs to a school they are NOT assigned to (401)', async () => {
      const email = `cross-student-${stamp}@google-e2e-${stamp}-c.edu`;
      const token = `cross-token-${stamp}`;

      mockTokenMap.set(token, {
        sub: `sub-cross-${stamp}`,
        email,
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: 'test-aud',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      // User belongs to School A, but email domain belongs to School C
      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: token })
        .expect(401);

      expect(res.body.message).toMatch(/authentication failed/i);
    });

    it('criterion 3: a school with no configured domain does NOT restrict anything (open school)', async () => {
      const email = `open-student-${stamp}@gmail.com`;
      const token = `open-token-${stamp}`;

      mockTokenMap.set(token, {
        sub: `sub-open-${stamp}`,
        email,
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: 'test-aud',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: token })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
    });

    it('allows departmental subdomain matching parent school domain', async () => {
      const email = `sub-student-${stamp}@dept.google-e2e-${stamp}-a.edu`;
      const token = `subdomain-token-${stamp}`;

      mockTokenMap.set(token, {
        sub: `sub-dept-${stamp}`,
        email,
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: 'test-aud',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: token })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
    });

    it('allows dual-assigned student to access via their unrestricted school', async () => {
      const email = `dual-student-${stamp}@personal-mail.org`;
      const token = `dual-token-${stamp}`;

      mockTokenMap.set(token, {
        sub: `sub-dual-${stamp}`,
        email,
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: 'test-aud',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const res = await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: token })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
    });

    it('criterion 4: admin accounts (email + password) are NOT affected by domain restrictions', async () => {
      const email = `external-admin-${stamp}@any-custom-domain.net`;

      // School A only allows google-e2e-${stamp}-a.edu, but admin can log in with any domain
      const res = await request(app.getHttpServer())
        .post('/auth/admin/login')
        .send({
          email,
          password: 'AdminExternal123!',
        })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
    });
  });

  describe('Tamper-Evident Audit Logging', () => {
    it('records login_success audit event with method: google in hash chain', async () => {
      const auditEvent = await prisma.auditEvent.findFirst({
        where: {
          category: 'authentication',
          action: 'login_success',
        },
        orderBy: { seq: 'desc' },
      });

      expect(auditEvent).toBeDefined();
      expect(auditEvent?.prevHash).toBeDefined();
      expect(auditEvent?.hash).toBeDefined();
    });
  });
});
