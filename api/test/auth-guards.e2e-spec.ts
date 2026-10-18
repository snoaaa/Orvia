import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { UserStatus } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** Acceptance criteria of #13: 401 / 403 / suspended / school scoping / public routes. */
describe('Auth guards (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const schoolIds: Record<'A' | 'B', string> = { A: '', B: '' };
  const userIds: Record<string, string> = {};

  const bearer = async (key: string) => `Bearer ${(await tokens.issueAccessToken(userIds[key])).accessToken}`;

  async function createUser(key: string, roleName: string, school: 'A' | 'B', status: UserStatus) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    const user = await prisma.user.create({
      data: { email: `e2e-guard-${key}-${stamp}@school.edu`, fullName: key, status },
    });
    await prisma.userAssignment.create({ data: { userId: user.id, roleId: role.id, schoolId: schoolIds[school] } });
    userIds[key] = user.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    schoolIds.A = (await prisma.school.create({ data: { name: `Test E2E Guard School A ${stamp}` } })).id;
    schoolIds.B = (await prisma.school.create({ data: { name: `Test E2E Guard School B ${stamp}` } })).id;
    await createUser('adminA', 'SCHOOL_ADMIN', 'A', 'ACTIVE');
    await createUser('studentA', 'STUDENT', 'A', 'ACTIVE');
    await createUser('suspendedA', 'SCHOOL_ADMIN', 'A', 'SUSPENDED');
    await createUser('invitedA', 'STUDENT', 'A', 'INVITED');
    await createUser('studentB', 'STUDENT', 'B', 'ACTIVE');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `e2e-guard-` } } });
    await prisma.school.deleteMany({ where: { name: { contains: `Test E2E Guard School` } } });
    await app.close();
  });

  describe('public routes', () => {
    it.each(['/', '/health'])('%s works without a token', async (path) => {
      await request(app.getHttpServer()).get(path).expect(200);
    });
  });

  describe('401', () => {
    it('rejects a request without a token', async () => {
      await request(app.getHttpServer()).get('/identity/users').expect(401);
    });

    it('rejects a malformed token', async () => {
      await request(app.getHttpServer()).get('/auth/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
    });

    it('rejects a token signed with another secret', async () => {
      const forged = await new JwtService({ secret: 'attacker-secret' }).signAsync({ sub: userIds.adminA, type: 'access' });
      await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
    });

    it('rejects an expired token', async () => {
      const expired = await app.get(JwtService).signAsync({ sub: userIds.adminA, type: 'access' }, { expiresIn: -10 });
      await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${expired}`).expect(401);
    });
  });

  describe('403', () => {
    it('rejects a missing permission', async () => {
      const res = await request(app.getHttpServer())
        .get('/identity/users')
        .set('Authorization', await bearer('studentA'))
        .expect(403);
      expect(res.body.message).toContain('users:read');
    });

    it('rejects a suspended user even with a valid token', async () => {
      await request(app.getHttpServer()).get('/auth/me').set('Authorization', await bearer('suspendedA')).expect(403);
    });

    it('rejects a user who has not activated the account', async () => {
      await request(app.getHttpServer()).get('/auth/me').set('Authorization', await bearer('invitedA')).expect(403);
    });

    it('applies a suspension to a token issued before it', async () => {
      const auth = await bearer('studentA');
      await request(app.getHttpServer()).get('/auth/me').set('Authorization', auth).expect(200);
      await prisma.user.update({ where: { id: userIds.studentA }, data: { status: 'SUSPENDED' } });
      await request(app.getHttpServer()).get('/auth/me').set('Authorization', auth).expect(403);
      await prisma.user.update({ where: { id: userIds.studentA }, data: { status: 'ACTIVE' } });
    });
  });

  describe('current user', () => {
    it('exposes roles, schools and permissions', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', await bearer('adminA'))
        .expect(200);
      expect(res.body).toMatchObject({
        id: userIds.adminA,
        role: 'SCHOOL_ADMIN',
        schoolId: schoolIds.A,
        isPlatformAdmin: false,
      });
      expect(res.body.permissions).toContain('users:invite');
    });
  });

  describe('school scoping', () => {
    it('a school admin cannot read a user of another school', async () => {
      await request(app.getHttpServer())
        .get(`/identity/users/${userIds.studentB}`)
        .set('Authorization', await bearer('adminA'))
        .expect(403);
    });

    it('a school admin can read a user of their own school', async () => {
      await request(app.getHttpServer())
        .get(`/identity/users/${userIds.studentA}`)
        .set('Authorization', await bearer('adminA'))
        .expect(200);
    });

    it('a school admin cannot update a user of another school', async () => {
      await request(app.getHttpServer())
        .patch(`/identity/users/${userIds.studentB}`)
        .set('Authorization', await bearer('adminA'))
        .send({ fullName: 'Changed' })
        .expect(403);
    });

    it('a school admin cannot invite into another school', async () => {
      await request(app.getHttpServer())
        .post('/identity/users')
        .set('Authorization', await bearer('adminA'))
        .send({ email: `e2e-guard-x-${stamp}@school.edu`, fullName: 'X', schoolId: schoolIds.B })
        .expect(403);
    });

    it('a school admin only lists users and schools of their school', async () => {
      const auth = await bearer('adminA');
      const users = await request(app.getHttpServer()).get('/identity/users').set('Authorization', auth).expect(200);
      const ids = users.body.map((u: { id: string }) => u.id);
      expect(ids).toContain(userIds.studentA);
      expect(ids).not.toContain(userIds.studentB);

      const schools = await request(app.getHttpServer()).get('/identity/schools').set('Authorization', auth).expect(200);
      expect(schools.body.map((s: { id: string }) => s.id)).toEqual([schoolIds.A]);
    });

    it('a school admin cannot create a space in another school', async () => {
      await request(app.getHttpServer())
        .post('/documents/spaces')
        .set('Authorization', await bearer('adminA'))
        .send({ name: 'Test E2E Guard Space', schoolId: schoolIds.B })
        .expect(403);
    });
  });

  describe('permission overview', () => {
    it('shows holders of a permission, limited to the admin school', async () => {
      const res = await request(app.getHttpServer())
        .get('/identity/permissions')
        .query({ code: 'users:invite' })
        .set('Authorization', await bearer('adminA'))
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].roles).toEqual(expect.arrayContaining(['PLATFORM_ADMIN', 'SCHOOL_ADMIN']));
      const holderSchools = new Set(res.body[0].holders.map((h: { schoolId: string }) => h.schoolId));
      expect([...holderSchools]).toEqual([schoolIds.A]);
    });
  });

  it('hides the dev token route when AUTH_DEV_TOOLS is off', async () => {
    await request(app.getHttpServer()).post('/auth/dev/token').send({ email: 'x@y.z' }).expect(404);
  });
});
