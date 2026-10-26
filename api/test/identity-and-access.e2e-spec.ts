import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('IdentityAndAccess (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  // All identity routes are protected since #13: act as the seeded platform administrator.
  let adminToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
    });
    adminToken = (await app.get(TokenService).issueAccessToken(admin.id)).accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: {
        email: {
          contains: 'test-e2e',
        },
      },
    });
    await prisma.school.deleteMany({
      where: {
        name: {
          contains: 'Test E2E School',
        },
      },
    });
    await app.close();
  });

  it('should create a user with default INVITED status', async () => {
    const email = `test-e2e-user-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/identity/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email,
        fullName: 'Test E2E User',
        authProvider: 'local',
        password: 'Password123!',
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.email).toBe(email);
    expect(res.body.fullName).toBe('Test E2E User');
    expect(res.body.status).toBe('INVITED');
  });

  it('should update user status from INVITED to ACTIVE and SUSPENDED', async () => {
    const email = `test-e2e-status-${Date.now()}@example.com`;
    const createRes = await request(app.getHttpServer())
      .post('/identity/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email,
        fullName: 'Status Lifecycle User',
        authProvider: 'local',
      })
      .expect(201);

    const userId = createRes.body.id;
    expect(createRes.body.status).toBe('INVITED');

    const activateRes = await request(app.getHttpServer())
      .patch(`/identity/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    expect(activateRes.body.status).toBe('ACTIVE');

    const suspendRes = await request(app.getHttpServer())
      .patch(`/identity/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'SUSPENDED' })
      .expect(200);

    expect(suspendRes.body.status).toBe('SUSPENDED');
  });

  it('should create a school and populate school_domains relation', async () => {
    const timestamp = Date.now();
    const domain1 = `e2e-${timestamp}-a.edu`;
    const domain2 = `e2e-${timestamp}-b.edu`;

    const res = await request(app.getHttpServer())
      .post('/identity/schools')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Test E2E School ${timestamp}`,
        allowedDomains: `${domain1}, ${domain2}`,
        settings: { campusCount: 3 },
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe(`Test E2E School ${timestamp}`);

    const domainsInDb = await prisma.schoolDomain.findMany({
      where: { schoolId: res.body.id },
    });

    expect(domainsInDb.length).toBe(2);
    const domainNames = domainsInDb.map((d) => d.domain);
    expect(domainNames).toContain(domain1);
    expect(domainNames).toContain(domain2);
  });

  it('should enforce unique constraint on school_domains', async () => {
    const timestamp = Date.now();
    const duplicateDomain = `unique-${timestamp}.edu`;

    const school1 = await prisma.school.create({
      data: {
        name: `School 1 ${timestamp}`,
        allowedDomains: duplicateDomain,
        domains: {
          create: [{ domain: duplicateDomain }],
        },
      },
    });

    expect(school1).toBeDefined();

    await expect(
      prisma.schoolDomain.create({
        data: {
          schoolId: school1.id,
          domain: duplicateDomain,
        },
      }),
    ).rejects.toThrow();

    await prisma.school.delete({
      where: { id: school1.id },
    });
  });

  it('should verify all 6 base roles exist in database', async () => {
    const res = await request(app.getHttpServer())
      .get('/identity/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const roleNames = res.body.map((r: { name: string }) => r.name);
    expect(roleNames).toContain('PLATFORM_ADMIN');
    expect(roleNames).toContain('SCHOOL_ADMIN');
    expect(roleNames).toContain('CONTENT_MANAGER');
    expect(roleNames).toContain('STAFF');
    expect(roleNames).toContain('STUDENT');
    expect(roleNames).toContain('PARENT_GUEST');
  });

  it('should verify first platform administrator exists with active status and hashed password', async () => {
    const adminEmail = process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform';
    const adminUser = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    expect(adminUser).toBeDefined();
    expect(adminUser?.email).toBe(adminEmail);
    expect(adminUser?.status).toBe('ACTIVE');
    expect(adminUser?.passwordHash).toBeDefined();
    expect(adminUser?.passwordHash).toMatch(/^\$2[aby]\$\d+\$/);
  });

  it('should verify PLATFORM_ADMIN role assignment and role-permissions in database', async () => {
    const adminEmail = process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform';
    const adminUser = await prisma.user.findUnique({
      where: { email: adminEmail },
    });
    expect(adminUser).toBeDefined();

    const platformRole = await prisma.role.findUnique({
      where: { name: 'PLATFORM_ADMIN' },
    });
    expect(platformRole).toBeDefined();

    const assignment = await prisma.userAssignment.findFirst({
      where: {
        userId: adminUser!.id,
        roleId: platformRole!.id,
      },
    });
    expect(assignment).toBeDefined();

    const rolePermissions = await prisma.rolePermission.findMany({
      where: { roleId: platformRole!.id },
    });
    expect(rolePermissions.length).toBeGreaterThanOrEqual(40);
  });

  it('should reject duplicate user email with 409 Conflict', async () => {
    const email = `test-e2e-duplicate-${Date.now()}@example.com`;
    await request(app.getHttpServer())
      .post('/identity/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email,
        fullName: 'First Copy',
        authProvider: 'local',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/identity/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email,
        fullName: 'Second Copy',
        authProvider: 'local',
      })
      .expect(409);

    expect(res.body.message).toContain('already exists');
  });

  it('should hash user password securely with bcrypt on user creation', async () => {
    const email = `test-e2e-pwd-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/identity/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email,
        fullName: 'Password Hashing User',
        password: 'SuperSecret2026!',
        authProvider: 'local',
      })
      .expect(201);

    const userInDb = await prisma.user.findUnique({
      where: { id: res.body.id },
    });

    expect(userInDb?.passwordHash).toBeDefined();
    expect(userInDb?.passwordHash).toMatch(/^\$2[aby]\$\d+\$/);
    expect(userInDb?.passwordHash).not.toBe('SuperSecret2026!');
  });

  it('should reject duplicate school domain with 409 Conflict', async () => {
    const timestamp = Date.now();
    const domain = `conflict-${timestamp}.edu`;

    await request(app.getHttpServer())
      .post('/identity/schools')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Test E2E School First ${timestamp}`,
        allowedDomains: domain,
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/identity/schools')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Test E2E School Second ${timestamp}`,
        allowedDomains: domain,
      })
      .expect(409);

    expect(res.body.message).toContain('already assigned');
  });
});


