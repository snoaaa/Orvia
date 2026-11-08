import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** POST /groups (#33): school scoping, name unique per school, validation. */
describe('Group creation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const schools = { A: '', B: '', Off: '' };
  const ids: Record<string, string> = {};
  let platformAdminId: string;

  const create = async (as: string, body: object) =>
    request(app.getHttpServer())
      .post('/groups')
      .set('Authorization', `Bearer ${(await tokens.issueAccessToken(as)).accessToken}`)
      .send(body);
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };

  async function user(key: string, roleName: string) {
    const created = await prisma.user.create({
      data: { email: `e2e-groups-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status: 'ACTIVE' },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await prisma.userAssignment.create({ data: { userId: created.id, schoolId: schools.A, roleId: role.id } });
    ids[key] = created.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    schools.A = (await prisma.school.create({ data: { name: `Test E2E Groups School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E Groups School B ${stamp}` } })).id;
    schools.Off = (
      await prisma.school.create({ data: { name: `Test E2E Groups School Off ${stamp}`, status: 'deactivated' } })
    ).id;

    await user('AdminA', 'SCHOOL_ADMIN');
    await user('ManagerA', 'CONTENT_MANAGER');
    await user('StudentA', 'STUDENT');

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@school.edu` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E Groups School' } } });
    await app.close();
  });

  describe('access', () => {
    it('requires a token', async () => {
      await request(app.getHttpServer()).post('/groups').send({ schoolId: schools.A, name: 'X' }).expect(401);
    });

    it.each(['ManagerA', 'StudentA'])('rejects %s (no groups:create permission)', async (key) => {
      check(await create(ids[key], { schoolId: schools.A, name: 'Denied' }), 403);
    });

    it('a school admin cannot create a group in another school', async () => {
      check(await create(ids.AdminA, { schoolId: schools.B, name: 'Denied' }), 403);
      expect(await prisma.group.count({ where: { schoolId: schools.B, name: 'Denied' } })).toBe(0);
    });
  });

  describe('creation', () => {
    it('a school admin creates a group linked to their school, of type class by default', async () => {
      const res = check(await create(ids.AdminA, { schoolId: schools.A, name: '  Class 4-A  ' }), 201);
      expect(res.body).toMatchObject({ schoolId: schools.A, name: 'Class 4-A', type: 'class' });
      expect(await prisma.group.findUnique({ where: { id: res.body.id } })).not.toBeNull();
    });

    it('a platform admin creates a group in any school, with a type', async () => {
      const res = check(await create(platformAdminId, { schoolId: schools.B, name: 'Maths', type: 'department' }), 201);
      expect(res.body).toMatchObject({ schoolId: schools.B, name: 'Maths', type: 'department' });
    });

    it('rejects an unknown school and a deactivated school', async () => {
      check(await create(platformAdminId, { schoolId: '00000000-0000-4000-8000-000000000000', name: 'X' }), 404);
      check(await create(platformAdminId, { schoolId: schools.Off, name: 'X' }), 400);
    });

    it.each([
      ['a missing schoolId', { name: 'X' }],
      ['an invalid schoolId', { schoolId: 'abc', name: 'X' }],
      ['a missing name', {}],
      ['a blank name', { name: '   ' }],
      ['a name over 191 characters', { name: 'x'.repeat(192) }],
      ['an unknown type', { name: 'X', type: 'club' }],
      ['an unknown field', { name: 'X', status: 'active' }],
    ])('rejects %s', async (label, body) => {
      const payload = label.includes('schoolId') ? body : { schoolId: schools.A, ...body };
      check(await create(platformAdminId, payload), 400);
    });
  });

  describe('unique name', () => {
    it('rejects a duplicate name in the same school, ignoring case', async () => {
      check(await create(ids.AdminA, { schoolId: schools.A, name: 'Team Blue' }), 201);
      const res = check(await create(ids.AdminA, { schoolId: schools.A, name: 'team blue' }), 409);
      expect(res.body.message).toContain('already exists');
    });

    it('allows the same name in another school', async () => {
      check(await create(platformAdminId, { schoolId: schools.A, name: 'Shared' }), 201);
      check(await create(platformAdminId, { schoolId: schools.B, name: 'Shared' }), 201);
    });

    it('lets only one of two simultaneous requests create the name', async () => {
      const body = { schoolId: schools.A, name: 'Race' };
      const results = await Promise.all([create(ids.AdminA, body), create(ids.AdminA, body)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });
  });
});
