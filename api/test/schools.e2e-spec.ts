import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('Schools (e2e) - Create, List and View (Issues #27 & #29)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let platformAdminToken: string;
  let schoolAdminToken: string;
  let studentToken: string;

  const testPrefix = `e2e-school-test-${Date.now()}`;
  let schoolAdminUserId: string;
  let studentUserId: string;
  let tempSchoolId: string;
  let anotherSchoolId: string;

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

    // Seed temporary schools for testing scoping and listings
    const tempSchool = await prisma.school.create({
      data: {
        name: `${testPrefix}-seed-school-assigned`,
        status: 'active',
        allowedDomains: '',
      },
    });
    tempSchoolId = tempSchool.id;

    const anotherSchool = await prisma.school.create({
      data: {
        name: `${testPrefix}-seed-school-unassigned`,
        status: 'active',
        allowedDomains: '',
      },
    });
    anotherSchoolId = anotherSchool.id;

    // 3. School Admin user (assigned only to tempSchoolId)
    const schoolAdminUser = await prisma.user.create({
      data: {
        email: `${testPrefix}-admin@school.local`,
        fullName: 'School Admin E2E',
        status: 'ACTIVE',
        assignments: {
          create: {
            schoolId: tempSchoolId,
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
            schoolId: tempSchoolId,
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

  describe('POST /schools (Issue #27)', () => {
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

      await request(app.getHttpServer())
        .post('/schools')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({ name: duplicateName })
        .expect(201);

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

  describe('GET /schools (Issue #29 - Pagination, Filters & Scoping)', () => {
    it('allows platform admin to list all schools with pagination metadata', async () => {
      const res = await request(app.getHttpServer())
        .get('/schools?page=1&limit=2')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(2);
      expect(res.body).toHaveProperty('total');
      expect(res.body.total).toBeGreaterThanOrEqual(2);
      expect(res.body).toHaveProperty('totalPages');
    });

    it('allows filtering by status and searching by name', async () => {
      const res = await request(app.getHttpServer())
        .get(`/schools?status=active&search=${encodeURIComponent(`${testPrefix}-seed-school-assigned`)}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(tempSchoolId);
      expect(res.body.data[0].status).toBe('active');
    });

    it('scopes results so a school admin only sees their own assigned school', async () => {
      const res = await request(app.getHttpServer())
        .get('/schools')
        .set('Authorization', `Bearer ${schoolAdminToken}`)
        .expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(tempSchoolId);
      expect(res.body.total).toBe(1);

      // Verify the other test school is NOT included in the results
      const ids = res.body.data.map((s: { id: string }) => s.id);
      expect(ids).not.toContain(anotherSchoolId);
    });

    it('rejects student listing schools with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get('/schools')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);

      expect(res.body.message).toContain('schools:read');
    });

    it('rejects unauthenticated list request with 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .get('/schools')
        .expect(401);
    });
  });

  describe('GET /schools/:id (Issue #29 - View Single School & Scoping)', () => {
    it('allows platform admin to read any school by ID', async () => {
      const res = await request(app.getHttpServer())
        .get(`/schools/${anotherSchoolId}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(200);

      expect(res.body.id).toBe(anotherSchoolId);
      expect(res.body.name).toBe(`${testPrefix}-seed-school-unassigned`);
    });

    it('allows school admin to read their own assigned school', async () => {
      const res = await request(app.getHttpServer())
        .get(`/schools/${tempSchoolId}`)
        .set('Authorization', `Bearer ${schoolAdminToken}`)
        .expect(200);

      expect(res.body.id).toBe(tempSchoolId);
      expect(res.body.name).toBe(`${testPrefix}-seed-school-assigned`);
    });

    it('rejects school admin reading another school with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get(`/schools/${anotherSchoolId}`)
        .set('Authorization', `Bearer ${schoolAdminToken}`)
        .expect(403);

      expect(res.body.message).toContain('You do not have access to this school');
    });

    it('returns 404 Not Found for non-existent school ID when requested by platform admin', async () => {
      const nonExistentUuid = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const res = await request(app.getHttpServer())
        .get(`/schools/${nonExistentUuid}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(404);

      expect(res.body.message).toContain(`School with ID '${nonExistentUuid}' not found`);
    });

    it('returns 400 Bad Request when ID is not a valid UUID', async () => {
      await request(app.getHttpServer())
        .get('/schools/not-a-uuid')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(400);
    });

    it('rejects student viewing school details with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get(`/schools/${tempSchoolId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);
    });

    it('rejects unauthenticated request to view school with 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .get(`/schools/${tempSchoolId}`)
        .expect(401);
    });
  });

  describe('PATCH /schools/:id (Issue #30 - Update School, Scoping & Validation)', () => {
    it('allows platform admin to update school name and settings and updates updated_at', async () => {
      // 1. Fetch initial school state
      const initial = await prisma.school.findUniqueOrThrow({ where: { id: anotherSchoolId } });

      // Small delay to ensure timestamp tick
      await new Promise((resolve) => setTimeout(resolve, 50));

      const updatedName = `${testPrefix}-updated-by-platform-admin`;
      const res = await request(app.getHttpServer())
        .patch(`/schools/${anotherSchoolId}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({
          name: updatedName,
          settings: { maxUsers: 5000, libraryAccess: true },
        })
        .expect(200);

      expect(res.body.id).toBe(anotherSchoolId);
      expect(res.body.name).toBe(updatedName);
      expect(res.body.settings).toEqual({ maxUsers: 5000, libraryAccess: true });

      // Verify updated_at changes
      const after = await prisma.school.findUniqueOrThrow({ where: { id: anotherSchoolId } });
      expect(new Date(after.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(initial.updatedAt).getTime());
    });

    it('allows school admin to edit only their own assigned school', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/schools/${tempSchoolId}`)
        .set('Authorization', `Bearer ${schoolAdminToken}`)
        .send({
          settings: { maxUsers: 750, quota: 'standard' },
        })
        .expect(200);

      expect(res.body.id).toBe(tempSchoolId);
      expect(res.body.settings).toEqual({ maxUsers: 750, quota: 'standard' });
    });

    it('rejects school admin editing another school with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/schools/${anotherSchoolId}`)
        .set('Authorization', `Bearer ${schoolAdminToken}`)
        .send({
          name: 'Unauthorized School Edit',
        })
        .expect(403);

      expect(res.body.message).toContain('You do not have access to this school');
    });

    it('rejects invalid settings with a clear 400 Bad Request error', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/schools/${tempSchoolId}`)
        .set('Authorization', `Bearer ${schoolAdminToken}`)
        .send({
          settings: 'invalid-string-settings',
        })
        .expect(400);

      expect(JSON.stringify(res.body.message)).toContain('settings must be an object');
    });

    it('rejects empty school name with 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .patch(`/schools/${tempSchoolId}`)
        .set('Authorization', `Bearer ${schoolAdminToken}`)
        .send({ name: '' })
        .expect(400);
    });

    it('rejects duplicate school name when updated to an existing school name with 409 Conflict', async () => {
      const existingSchool = await prisma.school.findUniqueOrThrow({ where: { id: anotherSchoolId } });

      const res = await request(app.getHttpServer())
        .patch(`/schools/${tempSchoolId}`)
        .set('Authorization', `Bearer ${schoolAdminToken}`)
        .send({ name: existingSchool.name })
        .expect(409);

      expect(res.body.message).toContain(`School with name '${existingSchool.name}' already exists`);
    });

    it('returns 404 Not Found for non-existent school ID when requested by platform admin', async () => {
      const nonExistentUuid = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const res = await request(app.getHttpServer())
        .patch(`/schools/${nonExistentUuid}`)
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({ name: 'Does Not Matter' })
        .expect(404);

      expect(res.body.message).toContain(`School with ID '${nonExistentUuid}' not found`);
    });

    it('rejects student editing a school with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .patch(`/schools/${tempSchoolId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ settings: { maxUsers: 10 } })
        .expect(403);
    });

    it('rejects unauthenticated request to edit school with 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .patch(`/schools/${tempSchoolId}`)
        .send({ settings: { maxUsers: 10 } })
        .expect(401);
    });
  });
});
