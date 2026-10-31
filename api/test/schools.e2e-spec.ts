import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('Schools (e2e) - Create a school (Issue #27)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let platformAdminToken: string;
  let schoolAdminToken: string;
  let studentToken: string;

  const testPrefix = `e2e-school-test-${Date.now()}`;
  let schoolAdminUserId: string;
  let studentUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    // 1. Platform admin token
    const platformAdmin = await prisma.user.findUniqueOrThrow({
      where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
    });
    platformAdminToken = (await tokens.issueAccessToken(platformAdmin.id)).accessToken;

    // 2. Base roles
    const schoolAdminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'SCHOOL_ADMIN' } });
    const studentRole = await prisma.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });

    // Seed temporary school for non-platform user assignments
    const tempSchool = await prisma.school.create({
      data: {
        name: `${testPrefix}-seed-school`,
        status: 'active',
        allowedDomains: '',
      },
    });

    // 3. School Admin user
    const schoolAdminUser = await prisma.user.create({
      data: {
        email: `${testPrefix}-admin@school.local`,
        fullName: 'School Admin E2E',
        status: 'ACTIVE',
        assignments: {
          create: {
            schoolId: tempSchool.id,
            roleId: schoolAdminRole.id,
          },
        },
      },
    });
    schoolAdminUserId = schoolAdminUser.id;
    schoolAdminToken = (await tokens.issueAccessToken(schoolAdminUser.id)).accessToken;

    // 4. Student user
    const studentUser = await prisma.user.create({
      data: {
        email: `${testPrefix}-student@school.local`,
        fullName: 'Student E2E',
        status: 'ACTIVE',
        assignments: {
          create: {
            schoolId: tempSchool.id,
            roleId: studentRole.id,
          },
        },
      },
    });
    studentUserId = studentUser.id;
    studentToken = (await tokens.issueAccessToken(studentUser.id)).accessToken;
  });

  afterAll(async () => {
    // Cleanup created test records
    await prisma.userAssignment.deleteMany({
      where: {
        userId: { in: [schoolAdminUserId, studentUserId].filter(Boolean) },
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [schoolAdminUserId, studentUserId].filter(Boolean) },
      },
    });
    await prisma.school.deleteMany({
      where: {
        name: { contains: testPrefix },
      },
    });
    await app.close();
  });

  describe('POST /schools - Acceptance criteria & authorization', () => {
    it('creates a school with status active when requested by platform admin', async () => {
      const schoolName = `${testPrefix}-Institute of Advanced AI`;
      const res = await request(app.getHttpServer())
        .post('/schools')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({
          name: schoolName,
          settings: { maxUsers: 1200, offlineSyncEnabled: true },
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe(schoolName);
      expect(res.body.status).toBe('active');
      expect(res.body.settings).toEqual({ maxUsers: 1200, offlineSyncEnabled: true });

      // Verify persisted state in database
      const saved = await prisma.school.findUnique({
        where: { id: res.body.id },
      });
      expect(saved).not.toBeNull();
      expect(saved?.name).toBe(schoolName);
      expect(saved?.status).toBe('active');
    });

    it('creates a school with status active when explicitly provided in body', async () => {
      const schoolName = `${testPrefix}-Polytechnic School`;
      const res = await request(app.getHttpServer())
        .post('/schools')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({
          name: schoolName,
          status: 'active',
        })
        .expect(201);

      expect(res.body.name).toBe(schoolName);
      expect(res.body.status).toBe('active');
    });

    it('rejects duplicate school name with clear 409 Conflict error', async () => {
      const duplicateName = `${testPrefix}-Unique Academy`;

      // 1. First creation succeeds
      await request(app.getHttpServer())
        .post('/schools')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({ name: duplicateName })
        .expect(201);

      // 2. Second creation with duplicate name fails with 409
      const res = await request(app.getHttpServer())
        .post('/schools')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({ name: duplicateName })
        .expect(409);

      expect(res.body.message).toContain(`School with name '${duplicateName}' already exists`);
    });

    it('rejects creation when school admin attempts to create a school (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .post('/schools')
        .set('Authorization', `Bearer ${schoolAdminToken}`)
        .send({ name: `${testPrefix}-Unauthorized School Admin` })
        .expect(403);

      expect(res.body.message).toContain('schools:create');
    });

    it('rejects creation when student attempts to create a school (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .post('/schools')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ name: `${testPrefix}-Unauthorized Student` })
        .expect(403);

      expect(res.body.message).toContain('schools:create');
    });

    it('rejects unauthenticated request with 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .post('/schools')
        .send({ name: `${testPrefix}-Unauthenticated` })
        .expect(401);
    });

    it('rejects missing or empty school name with 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .post('/schools')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({ settings: { maxUsers: 100 } })
        .expect(400);

      await request(app.getHttpServer())
        .post('/schools')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({ name: '' })
        .expect(400);
    });
  });
});

