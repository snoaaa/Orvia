import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuditService } from '../src/audit/services/audit.service.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** GET /audit/events (#96): school scoping, school/date/actor filters, pagination, names, read-only. */
describe('Audit events list (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const schools = { A: '', B: '' };
  const ids: Record<string, string> = {};
  let platformAdminId: string;

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const events = async (as: string, query: Record<string, string | number> = {}) =>
    http()
      .get('/audit/events')
      .query(query)
      .set('Authorization', await bearer(as));

  async function createUser(key: string, school: 'A' | 'B', role: string) {
    const u = await prisma.user.create({
      data: { email: `e2e-auditlist-${key.toLowerCase()}-${stamp}@school.edu`, fullName: `Audit ${key} ${stamp}`, status: 'ACTIVE' },
    });
    const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
    await prisma.userAssignment.create({ data: { userId: u.id, schoolId: schools[school], roleId: r.id } });
    ids[key] = u.id;
  }

  const record = (actorId: string | null, schoolId: string | null, deviceId: string) =>
    app.get(AuditService).record({
      category: 'identity_access',
      action: 'role_assigned',
      actor: { userId: actorId, role: 'SCHOOL_ADMIN', schoolId },
      entity: { type: 'user', id: actorId },
      details: { previousRole: 'STUDENT', role: 'STAFF' },
      context: { ip: '10.0.0.1', deviceId, userAgent: 'vitest' },
    });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    schools.A = (await prisma.school.create({ data: { name: `Test E2E Audit School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E Audit School B ${stamp}` } })).id;
    await createUser('AdminA', 'A', 'SCHOOL_ADMIN');
    await createUser('AdminB', 'B', 'SCHOOL_ADMIN');
    await createUser('StudentA', 'A', 'STUDENT');
    platformAdminId = (
      await prisma.user.findUniqueOrThrow({ where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' } })
    ).id;

    for (let i = 0; i < 3; i++) await record(ids.AdminA, schools.A, `e2e-auditlist-a-${stamp}`);
    await record(ids.AdminB, schools.B, `e2e-auditlist-b-${stamp}`);
    await record(null, null, `e2e-auditlist-none-${stamp}`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@school.edu` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E Audit School' } } });
    await app.close();
  });

  it('requires a token and the audit:read permission', async () => {
    await http().get('/audit/events').expect(401);
    expect((await events(ids.StudentA)).status).toBe(403);
  });

  it('returns the paginated shape with actor and school names', async () => {
    const res = await events(ids.AdminA, { actorId: ids.AdminA, limit: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, page: 1, limit: 2, totalPages: 2 });
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({
      actorName: `Audit AdminA ${stamp}`,
      actorEmail: `e2e-auditlist-admina-${stamp}@school.edu`,
      schoolName: `Test E2E Audit School A ${stamp}`,
      details: { previousRole: 'STUDENT', role: 'STAFF' },
    });
    const page2 = await events(ids.AdminA, { actorId: ids.AdminA, limit: 2, page: 2 });
    expect(page2.body.data).toHaveLength(1);
  });

  it('a school admin never sees another school or school-less events', async () => {
    const res = await events(ids.AdminA, { limit: 100 });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((e: { schoolId: string }) => e.schoolId === schools.A)).toBe(true);
  });

  it('a school admin asking for another school gets 403', async () => {
    expect((await events(ids.AdminA, { schoolId: schools.B })).status).toBe(403);
    expect((await events(ids.AdminA, { schoolId: schools.A })).status).toBe(200);
  });

  it('a platform admin can filter on any school and sees school-less events unfiltered', async () => {
    const b = await events(platformAdminId, { schoolId: schools.B, limit: 100 });
    expect(b.status).toBe(200);
    expect(b.body.total).toBe(1);
    const all = await events(platformAdminId, { limit: 100 });
    expect(all.body.data.some((e: { schoolId: string | null }) => e.schoolId === null)).toBe(true);
  });

  it('filters on a date range and rejects from after to', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const none = await events(platformAdminId, { schoolId: schools.A, from: future });
    expect(none.body.total).toBe(0);
    expect(none.body.totalPages).toBe(1);
    const past = new Date(stamp - 60_000).toISOString();
    const some = await events(platformAdminId, { schoolId: schools.A, from: past, to: future });
    expect(some.body.total).toBe(3);
    const todayDateOnly = new Date().toISOString().slice(0, 10);
    const sameDay = await events(platformAdminId, { schoolId: schools.A, from: todayDateOnly, to: todayDateOnly });
    expect(sameDay.body.total).toBe(3);
    expect((await events(platformAdminId, { from: future, to: past })).status).toBe(400);
  });

  it('validates its query', async () => {
    expect((await events(platformAdminId, { schoolId: 'nope' })).status).toBe(400);
    expect((await events(platformAdminId, { actorId: 'not-a-uuid' })).status).toBe(400);
    expect((await events(platformAdminId, { from: 'yesterday' })).status).toBe(400);
    expect((await events(platformAdminId, { limit: 101 })).status).toBe(400);
    expect((await events(platformAdminId, { page: 0 })).status).toBe(400);
  });
});
