import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** PATCH /users/:id (#40): profile edit, school scoping, email domain and uniqueness checks. */
describe('User edit (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const allowedDomain = `allowed-${stamp}.edu`;
  const schools = { A: '', B: '', Open: '' };
  const ids: Record<string, string> = {};
  let platformAdminId: string;

  const mail = (key: string, domain = allowedDomain) => `e2e-useredit-${key.toLowerCase()}-${stamp}@${domain}`;
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const edit = async (as: string, id: string, body: object) =>
    request(app.getHttpServer())
      .patch(`/users/${id}`)
      .set('Authorization', await bearer(as))
      .send(body);
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };

  async function user(key: string, assignments: { school: keyof typeof schools; role: string }[]) {
    const created = await prisma.user.create({ data: { email: mail(key), fullName: key, status: 'ACTIVE' } });
    for (const a of assignments) {
      const role = await prisma.role.findUniqueOrThrow({ where: { name: a.role } });
      await prisma.userAssignment.create({ data: { userId: created.id, schoolId: schools[a.school], roleId: role.id } });
    }
    ids[key] = created.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    schools.A = (await prisma.school.create({ data: { name: `Test E2E UserEdit School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E UserEdit School B ${stamp}` } })).id;
    schools.Open = (await prisma.school.create({ data: { name: `Test E2E UserEdit School Open ${stamp}` } })).id;
    await prisma.schoolDomain.create({ data: { schoolId: schools.A, domain: allowedDomain } });

    await user('AdminA', [{ school: 'A', role: 'SCHOOL_ADMIN' }]);
    await user('ManagerA', [{ school: 'A', role: 'CONTENT_MANAGER' }]);
    await user('StudentA', [{ school: 'A', role: 'STUDENT' }]);
    await user('StudentB', [{ school: 'B', role: 'STUDENT' }]);
    await user('Mixed', [{ school: 'A', role: 'STUDENT' }, { school: 'Open', role: 'STAFF' }]);
    await user('Orphan', []);

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E UserEdit School' } } });
    await app.close();
  });

  describe('access', () => {
    it('requires a token', async () => {
      await request(app.getHttpServer()).patch(`/users/${ids.StudentA}`).send({ fullName: 'X' }).expect(401);
    });

    it.each(['StudentA', 'ManagerA'])('rejects %s (no users:update permission)', async (key) => {
      check(await edit(ids[key], ids.StudentA, { fullName: 'X' }), 403);
    });

    it('a school admin cannot edit a user of another school or without a school', async () => {
      check(await edit(ids.AdminA, ids.StudentB, { fullName: 'X' }), 403);
      check(await edit(ids.AdminA, ids.Orphan, { fullName: 'X' }), 403);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: ids.StudentB } });
      expect(row.fullName).toBe('StudentB');
    });

    it('a platform admin can edit a user of any school', async () => {
      const res = check(await edit(platformAdminId, ids.StudentB, { fullName: 'Renamed B' }), 200);
      expect(res.body.fullName).toBe('Renamed B');
    });
  });

  describe('profile', () => {
    it('a school admin edits the full name, and updated_at changes', async () => {
      const past = new Date(Date.now() - 60_000);
      await prisma.user.update({ where: { id: ids.StudentA }, data: { updatedAt: past } });

      const res = check(await edit(ids.AdminA, ids.StudentA, { fullName: '  Jane Doe  ' }), 200);
      expect(res.body).toMatchObject({ id: ids.StudentA, fullName: 'Jane Doe', email: mail('StudentA') });
      const row = await prisma.user.findUniqueOrThrow({ where: { id: ids.StudentA } });
      expect(row.fullName).toBe('Jane Doe');
      expect(row.updatedAt.getTime()).toBeGreaterThan(past.getTime());
    });

    it('does not write when nothing changes, so updated_at stays the same', async () => {
      const current = await prisma.user.findUniqueOrThrow({ where: { id: ids.StudentB } });
      const past = new Date(Date.now() - 60_000);
      await prisma.user.update({ where: { id: ids.StudentB }, data: { updatedAt: past } });

      check(await edit(platformAdminId, ids.StudentB, { fullName: current.fullName, email: current.email }), 200);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: ids.StudentB } });
      expect(row.updatedAt.getTime()).toBe(past.getTime());
    });

    it('never returns the password hash or tokens', async () => {
      const res = check(await edit(ids.AdminA, ids.StudentA, { fullName: 'Jane Doe' }), 200);
      const raw = JSON.stringify(res.body);
      for (const field of ['passwordHash', 'password_hash', 'googleSub', 'setupToken', 'refreshToken']) {
        expect(raw).not.toContain(field);
      }
    });

    it('rejects an empty body, a blank name, an invalid email, an invalid id and an unknown user', async () => {
      check(await edit(platformAdminId, ids.StudentA, {}), 400);
      check(await edit(platformAdminId, ids.StudentA, { fullName: '   ' }), 400);
      check(await edit(platformAdminId, ids.StudentA, { email: 'nope' }), 400);
      check(await edit(platformAdminId, 'not-a-uuid', { fullName: 'X' }), 400);
      check(await edit(platformAdminId, '00000000-0000-4000-8000-000000000000', { fullName: 'X' }), 404);
    });

    it('cannot change the status', async () => {
      check(await edit(ids.AdminA, ids.StudentA, { status: 'SUSPENDED' }), 400);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: ids.StudentA } });
      expect(row.status).toBe('ACTIVE');
    });
  });

  describe('email', () => {
    it('accepts an email in an allowed domain and normalizes it', async () => {
      const email = mail('new-a');
      const res = check(await edit(ids.AdminA, ids.StudentA, { email: `  ${email.toUpperCase()} ` }), 200);
      expect(res.body.email).toBe(email);
    });

    it('rejects an email outside the allowed domains', async () => {
      const before = await prisma.user.findUniqueOrThrow({ where: { id: ids.AdminA } });
      const res = check(await edit(ids.AdminA, ids.AdminA, { email: mail('out', 'elsewhere.org') }), 400);
      expect(res.body.message).toContain('is not allowed');
      const row = await prisma.user.findUniqueOrThrow({ where: { id: ids.AdminA } });
      expect(row.email).toBe(before.email);
    });

    it('also rejects it on the older PATCH /identity/users/:id route', async () => {
      await request(app.getHttpServer())
        .patch(`/identity/users/${ids.ManagerA}`)
        .set('Authorization', await bearer(platformAdminId))
        .send({ email: mail('out2', 'elsewhere.org') })
        .expect(400);
    });

    it('lets a user who also belongs to an unrestricted school use another domain', async () => {
      check(await edit(platformAdminId, ids.Mixed, { email: mail('mixed', 'elsewhere.org') }), 200);
    });

    it('does not apply a domain check to a user without a school', async () => {
      check(await edit(platformAdminId, ids.Orphan, { email: mail('orphan', 'elsewhere.org') }), 200);
    });

    it("does not reject the user's current email even when its domain is no longer allowed", async () => {
      const email = mail('legacy', 'old-domain.org');
      await prisma.user.update({ where: { id: ids.ManagerA }, data: { email } });
      check(await edit(ids.AdminA, ids.ManagerA, { email, fullName: 'Manager' }), 200);
    });

    it("rejects another user's email", async () => {
      const taken = await prisma.user.findUniqueOrThrow({ where: { id: ids.AdminA } });
      check(await edit(platformAdminId, ids.StudentB, { email: taken.email }), 409);
    });
  });
});
