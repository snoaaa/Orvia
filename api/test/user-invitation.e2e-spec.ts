import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * E2E test suite for Issue #9: Minimal User Invitation & School Domain Validation.
 *
 * Acceptance Criteria verified:
 *  - 401 Unauthorized when unauthenticated.
 *  - 403 Forbidden when caller lacks `users:invite` permission.
 *  - 403 Forbidden when school admin attempts to invite into a school they do not manage.
 *  - 400 Bad Request when school admin omits `schoolId`.
 *  - 400 Bad Request when email domain violates target school's configured `school_domains`.
 *  - 201 Created when email domain matches target school's configured domains.
 *  - 201 Created when school has zero configured domains (unrestricted institutional onboarding).
 *  - Defaults role to STUDENT when role is omitted.
 *  - Successfully assigns custom valid school role (e.g. STAFF).
 *  - 403 Forbidden when school admin attempts to assign platform-scoped role (PLATFORM_ADMIN).
 *  - 409 Conflict on duplicate email registration (case-insensitive).
 *  - User is persisted with status INVITED, authProvider 'google', and null passwordHash.
 *  - User assignment is persisted linking user, school, and role atomically.
 *  - Tamper-evident audit event `identity_access/user_invited` is recorded in audit chain.
 */
describe('User Invitation E2E (Issue #9)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;

  const stamp = Date.now();
  let schoolAId: string;
  let schoolBId: string;
  let unrestrictedSchoolId: string;

  let platformAdminToken: string;
  let schoolAdminAToken: string;
  let studentToken: string;

  let staffRoleId: string;
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
    tokens = app.get(TokenService);

    // Resolve roles
    const staffRole = await prisma.role.findUniqueOrThrow({ where: { name: 'STAFF' } });
    const studentRole = await prisma.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });
    const schoolAdminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'SCHOOL_ADMIN' } });
    staffRoleId = staffRole.id;
    studentRoleId = studentRole.id;

    // 1. Create School A with domain: school-a.edu
    const schoolA = await prisma.school.create({
      data: {
        name: `Invitation E2E School A ${stamp}`,
        allowedDomains: `school-a-${stamp}.edu`,
        domains: {
          create: [{ domain: `school-a-${stamp}.edu` }],
        },
      },
    });
    schoolAId = schoolA.id;

    // 2. Create School B with domain: school-b.edu
    const schoolB = await prisma.school.create({
      data: {
        name: `Invitation E2E School B ${stamp}`,
        allowedDomains: `school-b-${stamp}.edu`,
        domains: {
          create: [{ domain: `school-b-${stamp}.edu` }],
        },
      },
    });
    schoolBId = schoolB.id;

    // 3. Create Unrestricted School (0 configured domains in school_domains)
    const unrestrictedSchool = await prisma.school.create({
      data: {
        name: `Invitation E2E Open School ${stamp}`,
      },
    });
    unrestrictedSchoolId = unrestrictedSchool.id;

    // 4. Create Platform Admin user and token
    const pAdmin = await prisma.user.findUniqueOrThrow({
      where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
    });
    platformAdminToken = (await tokens.issueAccessToken(pAdmin.id)).accessToken;

    // 5. Create School Admin for School A
    const saUser = await prisma.user.create({
      data: {
        email: `sa-invite-e2e-${stamp}@school-a-${stamp}.edu`,
        fullName: 'School Admin A',
        status: 'ACTIVE',
        authProvider: 'local',
      },
    });
    await prisma.userAssignment.create({
      data: {
        userId: saUser.id,
        schoolId: schoolAId,
        roleId: schoolAdminRole.id,
      },
    });
    schoolAdminAToken = (await tokens.issueAccessToken(saUser.id)).accessToken;

    // 6. Create Student user in School A (lacks users:invite permission)
    const stUser = await prisma.user.create({
      data: {
        email: `st-invite-e2e-${stamp}@school-a-${stamp}.edu`,
        fullName: 'Student A',
        status: 'ACTIVE',
        authProvider: 'local',
      },
    });
    await prisma.userAssignment.create({
      data: {
        userId: stUser.id,
        schoolId: schoolAId,
        roleId: studentRoleId,
      },
    });
    studentToken = (await tokens.issueAccessToken(stUser.id)).accessToken;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({
      where: { user: { email: { contains: `invite-e2e-${stamp}` } } },
    });
    await prisma.userAssignment.deleteMany({
      where: { user: { email: { contains: `invite-e2e-${stamp}` } } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: `invite-e2e-${stamp}` } },
    });
    const safeSchoolIds = [schoolAId, schoolBId, unrestrictedSchoolId].filter(Boolean);
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

  describe('Authentication & Authorization Guards', () => {
    it('returns 401 Unauthorized when unauthenticated', async () => {
      await request(app.getHttpServer())
        .post('/identity/users/invite')
        .send({
          email: `unauth-invite-e2e-${stamp}@school-a-${stamp}.edu`,
          fullName: 'Unauth User',
          schoolId: schoolAId,
        })
        .expect(401);
    });

    it('returns 403 Forbidden when caller lacks users:invite permission (student)', async () => {
      await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          email: `student-attempt-invite-e2e-${stamp}@school-a-${stamp}.edu`,
          fullName: 'Attempted User',
          schoolId: schoolAId,
        })
        .expect(403);
    });

    it('returns 403 Forbidden when school admin attempts to invite into another school', async () => {
      await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${schoolAdminAToken}`)
        .send({
          email: `cross-school-invite-e2e-${stamp}@school-b-${stamp}.edu`,
          fullName: 'Cross School User',
          schoolId: schoolBId,
        })
        .expect(403);
    });

    it('returns 400 Bad Request when school admin provides no schoolId', async () => {
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${schoolAdminAToken}`)
        .send({
          email: `no-school-invite-e2e-${stamp}@school-a-${stamp}.edu`,
          fullName: 'No School Provided',
        })
        .expect(400);

      expect(res.body.message).toMatch(/schoolId is required/i);
    });

    it('returns 403 Forbidden when school admin attempts to assign a platform-scoped role', async () => {
      await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${schoolAdminAToken}`)
        .send({
          email: `priv-esc-invite-e2e-${stamp}@school-a-${stamp}.edu`,
          fullName: 'Escalation Attempt',
          schoolId: schoolAId,
          role: 'PLATFORM_ADMIN',
        })
        .expect(403);
    });
  });

  describe('Payload Validation (400 Bad Request)', () => {
    it('returns 400 when email is invalid', async () => {
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${schoolAdminAToken}`)
        .send({
          email: 'not-an-email',
          fullName: 'Invalid Email',
          schoolId: schoolAId,
        })
        .expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/email/i)]),
      );
    });

    it('returns 400 when fullName is empty', async () => {
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${schoolAdminAToken}`)
        .send({
          email: `empty-name-invite-e2e-${stamp}@school-a-${stamp}.edu`,
          fullName: '',
          schoolId: schoolAId,
        })
        .expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/fullName/i)]),
      );
    });

    it('returns 400 when role is specified without schoolId (platform admin)', async () => {
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({
          email: `role-no-school-invite-e2e-${stamp}@global.edu`,
          fullName: 'Role No School',
          role: 'STUDENT',
        })
        .expect(400);

      expect(res.body.message).toMatch(/role requires schoolId/i);
    });

    it('returns 400 when role does not exist', async () => {
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${schoolAdminAToken}`)
        .send({
          email: `unknown-role-invite-e2e-${stamp}@school-a-${stamp}.edu`,
          fullName: 'Unknown Role',
          schoolId: schoolAId,
          role: 'SUPER_HERO',
        })
        .expect(400);

      expect(res.body.message).toMatch(/unknown role/i);
    });
  });

  describe('School Domain Validation (Issue #9 & #11)', () => {
    it('rejects invitation with 400 when domain does not match school configured domains', async () => {
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${schoolAdminAToken}`)
        .send({
          email: `disallowed-invite-e2e-${stamp}@gmail.com`,
          fullName: 'Disallowed User',
          schoolId: schoolAId,
        })
        .expect(400);

      expect(res.body.message).toContain("Email domain '@gmail.com' is not allowed for this school");
    });

    it('rejects invitation with 400 when domain belongs to a different school', async () => {
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${schoolAdminAToken}`)
        .send({
          email: `wrong-school-invite-e2e-${stamp}@school-b-${stamp}.edu`,
          fullName: 'Wrong School User',
          schoolId: schoolAId,
        })
        .expect(400);

      expect(res.body.message).toContain(`Email domain '@school-b-${stamp}.edu' is not allowed for this school`);
    });

    it('successfully invites user when domain matches school configured domain', async () => {
      const email = `valid-student-invite-e2e-${stamp}@school-a-${stamp}.edu`;
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${schoolAdminAToken}`)
        .send({
          email,
          fullName: 'Valid Student',
          schoolId: schoolAId,
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.email).toBe(email);
      expect(res.body.fullName).toBe('Valid Student');
      expect(res.body.status).toBe('INVITED');
      expect(res.body.authProvider).toBe('google');
      expect(res.body.passwordHash).toBeUndefined();

      // Verify in DB
      const dbUser = await prisma.user.findUniqueOrThrow({
        where: { id: res.body.id },
        include: { assignments: true },
      });
      expect(dbUser.status).toBe('INVITED');
      expect(dbUser.authProvider).toBe('google');
      expect(dbUser.passwordHash).toBeNull();
      expect(dbUser.assignments).toHaveLength(1);
      expect(dbUser.assignments[0].schoolId).toBe(schoolAId);
      expect(dbUser.assignments[0].roleId).toBe(studentRoleId);
    });

    it('allows invitation with any domain when school has zero configured domains (unrestricted)', async () => {
      const email = `open-school-invite-e2e-${stamp}@arbitrary-domain.org`;
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({
          email,
          fullName: 'Open School Student',
          schoolId: unrestrictedSchoolId,
        })
        .expect(201);

      expect(res.body.status).toBe('INVITED');
      expect(res.body.email).toBe(email);

      const dbUser = await prisma.user.findUniqueOrThrow({
        where: { id: res.body.id },
        include: { assignments: true },
      });
      expect(dbUser.status).toBe('INVITED');
      expect(dbUser.assignments[0].schoolId).toBe(unrestrictedSchoolId);
      expect(dbUser.assignments[0].roleId).toBe(studentRoleId);
    });

    it('assigns custom specified role (STAFF) within school', async () => {
      const email = `valid-staff-invite-e2e-${stamp}@school-a-${stamp}.edu`;
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${schoolAdminAToken}`)
        .send({
          email,
          fullName: 'Valid Staff',
          schoolId: schoolAId,
          role: 'STAFF',
        })
        .expect(201);

      const dbUser = await prisma.user.findUniqueOrThrow({
        where: { id: res.body.id },
        include: { assignments: true },
      });
      expect(dbUser.assignments[0].roleId).toBe(staffRoleId);
    });
  });

  describe('Duplicate Email Conflict (409 Conflict)', () => {
    it('rejects duplicate invitation with 409 Conflict (case-insensitive)', async () => {
      const email = `duplicate-invite-e2e-${stamp}@school-a-${stamp}.edu`;

      // 1. Initial invitation succeeds
      await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${schoolAdminAToken}`)
        .send({
          email,
          fullName: 'First Invitee',
          schoolId: schoolAId,
        })
        .expect(201);

      // 2. Duplicate with upper-case email throws 409
      const upperEmail = `DUPLICATE-invite-e2e-${stamp}@school-a-${stamp}.edu`;
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${schoolAdminAToken}`)
        .send({
          email: upperEmail,
          fullName: 'Second Invitee',
          schoolId: schoolAId,
        })
        .expect(409);

      expect(res.body.message).toMatch(/already exists/i);
    });
  });

  describe('Audit Logging', () => {
    it('creates tamper-evident audit event identity_access/user_invited', async () => {
      const email = `audit-test-invite-e2e-${stamp}@school-a-${stamp}.edu`;
      const res = await request(app.getHttpServer())
        .post('/identity/users/invite')
        .set('Authorization', `Bearer ${schoolAdminAToken}`)
        .send({
          email,
          fullName: 'Audited User',
          schoolId: schoolAId,
        })
        .expect(201);

      const auditEvent = await prisma.auditEvent.findFirst({
        where: {
          category: 'identity_access',
          action: 'user_invited',
          entityId: res.body.id,
        },
      });

      expect(auditEvent).toBeDefined();
      expect(auditEvent?.actorId).toBeDefined();
      expect(auditEvent?.prevHash).toBeDefined();
      expect(auditEvent?.hash).toBeDefined();
    });
  });
});
