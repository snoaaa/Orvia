import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** GET/POST/DELETE /schools/:id/domains (#32): normalization, format, one school per domain, effect on invitations. */
describe('School domains (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  // Domains of this suite end with this tag, so they never collide with other data.
  const tld = `t${stamp}.test`;
  const schools = { A: '', B: '' };
  const ids: Record<string, string> = {};
  let platformAdminId: string;

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const add = async (as: string, schoolId: string, domain: unknown) =>
    http()
      .post(`/schools/${schoolId}/domains`)
      .set('Authorization', await bearer(as))
      .send({ domain });
  const remove = async (as: string, schoolId: string, domainId: string) =>
    http()
      .delete(`/schools/${schoolId}/domains/${domainId}`)
      .set('Authorization', await bearer(as));
  const list = async (as: string, schoolId: string) =>
    http()
      .get(`/schools/${schoolId}/domains`)
      .set('Authorization', await bearer(as));
  const invite = async (as: string, schoolId: string, email: string) =>
    http()
      .post('/identity/users/invite')
      .set('Authorization', await bearer(as))
      .send({ email, fullName: 'Invitee', schoolId, role: 'STUDENT' });
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };

  async function user(key: string, school: keyof typeof schools, roleName: string) {
    const created = await prisma.user.create({
      data: { email: `e2e-schooldomains-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status: 'ACTIVE' },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await prisma.userAssignment.create({ data: { userId: created.id, schoolId: schools[school], roleId: role.id } });
    ids[key] = created.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    schools.A = (await prisma.school.create({ data: { name: `Test E2E SchoolDomains School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E SchoolDomains School B ${stamp}` } })).id;
    await user('AdminA', 'A', 'SCHOOL_ADMIN');
    await user('ManagerA', 'A', 'CONTENT_MANAGER');

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E SchoolDomains School' } } });
    await app.close();
  });

  describe('access', () => {
    it('requires a token', async () => {
      await http().get(`/schools/${schools.A}/domains`).expect(401);
      await http().post(`/schools/${schools.A}/domains`).send({ domain: `x.${tld}` }).expect(401);
    });

    it('a content manager cannot add or remove domains', async () => {
      check(await add(ids.ManagerA, schools.A, `manager.${tld}`), 403);
      check(await remove(ids.ManagerA, schools.A, '00000000-0000-4000-8000-000000000000'), 403);
    });

    it('a school admin cannot read or change the domains of another school', async () => {
      check(await add(ids.AdminA, schools.B, `other.${tld}`), 403);
      check(await list(ids.AdminA, schools.B), 403);
    });

    it('a platform admin can change any school', async () => {
      const res = check(await add(platformAdminId, schools.B, `platform.${tld}`), 201);
      check(await remove(platformAdminId, schools.B, res.body.id), 204);
    });
  });

  describe('adding', () => {
    it('normalizes the domain and keeps the school text copy in sync', async () => {
      const res = check(await add(ids.AdminA, schools.A, `  @Lycee.${tld.toUpperCase()} `), 201);
      expect(res.body).toMatchObject({ schoolId: schools.A, domain: `lycee.${tld}` });

      const listed = check(await list(ids.AdminA, schools.A), 200);
      expect(listed.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: res.body.id, domain: `lycee.${tld}` })]));
      const school = await prisma.school.findUniqueOrThrow({ where: { id: schools.A } });
      expect(school.allowedDomains.split(',')).toContain(`lycee.${tld}`);
    });

    it.each(['school', 'a..edu', '-x.edu', `user@x.${tld}`, `http://x.${tld}`, `*.x.${tld}`, 'x.123', '', 42])(
      'rejects the invalid domain %j',
      async (domain) => {
        check(await add(ids.AdminA, schools.A, domain), 400);
      },
    );

    it('rejects a domain this school already has', async () => {
      check(await add(ids.AdminA, schools.A, `twice.${tld}`), 201);
      const res = check(await add(ids.AdminA, schools.A, `TWICE.${tld}`), 409);
      expect(res.body.message).toContain('already allowed for this school');
    });

    it('a domain cannot belong to two schools, nor its parent or subdomains', async () => {
      check(await add(platformAdminId, schools.B, `shared.${tld}`), 201);
      expect(check(await add(ids.AdminA, schools.A, `shared.${tld}`), 409).body.message).toContain('another school');
      expect(check(await add(ids.AdminA, schools.A, `cs.shared.${tld}`), 409).body.message).toContain('overlaps');
      check(await add(platformAdminId, schools.B, `deep.parent.${tld}`), 201);
      check(await add(ids.AdminA, schools.A, `parent.${tld}`), 409);
    });

    it('only one of two simultaneous requests gets the domain', async () => {
      const domain = `race.${tld}`;
      const results = await Promise.all([add(platformAdminId, schools.A, domain), add(platformAdminId, schools.B, domain)]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
    });

    it('answers 404 for an unknown school and 400 for an invalid school id', async () => {
      check(await add(platformAdminId, '00000000-0000-4000-8000-000000000000', `x.${tld}`), 404);
      check(await add(platformAdminId, 'abc', `x.${tld}`), 400);
    });
  });

  describe('removing', () => {
    it('removes a domain and updates the text copy', async () => {
      const res = check(await add(ids.AdminA, schools.A, `gone.${tld}`), 201);
      check(await remove(ids.AdminA, schools.A, res.body.id), 204);
      expect(await prisma.schoolDomain.findUnique({ where: { id: res.body.id } })).toBeNull();
      const school = await prisma.school.findUniqueOrThrow({ where: { id: schools.A } });
      expect(school.allowedDomains.split(',')).not.toContain(`gone.${tld}`);
      check(await remove(ids.AdminA, schools.A, res.body.id), 404);
    });

    it('a domain of another school is not found through this school', async () => {
      const other = check(await add(platformAdminId, schools.B, `elsewhere.${tld}`), 201);
      check(await remove(platformAdminId, schools.A, other.body.id), 404);
      expect(await prisma.schoolDomain.findUnique({ where: { id: other.body.id } })).not.toBeNull();
    });

    it('answers 400 for an invalid domain id', async () => {
      check(await remove(ids.AdminA, schools.A, 'abc'), 400);
    });
  });

  it('applies to the next invitation', async () => {
    const school = (await prisma.school.create({ data: { name: `Test E2E SchoolDomains School Invite ${stamp}` } })).id;
    const outsider = `outsider-${stamp}@elsewhere-${tld}`;

    const added = check(await add(platformAdminId, school, `invite.${tld}`), 201);
    check(await invite(platformAdminId, school, outsider), 400);
    check(await invite(platformAdminId, school, `in-${stamp}@invite.${tld}`), 201);

    // Without any domain left, the school restricts nothing.
    check(await remove(platformAdminId, school, added.body.id), 204);
    check(await invite(platformAdminId, school, outsider), 201);
  });

  describe('POST and PATCH /schools reuse the same rules', () => {
    it('reject an invalid domain in allowedDomains', async () => {
      const auth = await bearer(platformAdminId);
      check(await http().patch(`/schools/${schools.B}`).set('Authorization', auth).send({ allowedDomains: 'not a domain' }), 400);
      check(
        await http().post('/schools').set('Authorization', auth).send({ name: `Test E2E SchoolDomains School C ${stamp}`, allowedDomains: 'bad' }),
        400,
      );
    });

    it('reject a subdomain of another school, and normalize the text copy', async () => {
      const auth = await bearer(platformAdminId);
      check(await add(platformAdminId, schools.B, `patch.${tld}`), 201);
      check(await http().patch(`/schools/${schools.A}`).set('Authorization', auth).send({ allowedDomains: `x.patch.${tld}` }), 409);

      const res = check(
        await http().post('/schools').set('Authorization', auth).send({ name: `Test E2E SchoolDomains School D ${stamp}`, allowedDomains: ` @New.${tld.toUpperCase()} ` }),
        201,
      );
      expect(res.body.allowedDomains).toBe(`new.${tld}`);
    });
  });
});
