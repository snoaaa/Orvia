import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** GET /permissions: platform admins only; the list is the seeded permission catalogue. */
describe('Permissions list (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const ids: Record<string, string> = {};
  let schoolId: string;
  let platformAdminId: string;

  /** Calls GET /permissions (as `as` when given) and resolves to the response. */
  const list = async (as?: string) => {
    const req = request(app.getHttpServer()).get('/permissions');
    return as ? req.set('Authorization', `Bearer ${(await tokens.issueAccessToken(as)).accessToken}`) : req;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    schoolId = (await prisma.school.create({ data: { name: `Test E2E Permissions School ${stamp}` } })).id;
    for (const role of ['SCHOOL_ADMIN', 'CONTENT_MANAGER', 'STAFF', 'STUDENT', 'PARENT_GUEST']) {
      const user = await prisma.user.create({
        data: { email: `e2e-permissions-${role.toLowerCase()}-${stamp}@school.edu`, fullName: role, status: 'ACTIVE' },
      });
      const { id: roleId } = await prisma.role.findUniqueOrThrow({ where: { name: role } });
      await prisma.userAssignment.create({ data: { userId: user.id, schoolId, roleId } });
      ids[role] = user.id;
    }
    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E Permissions School' } } });
    await app.close();
  });

  it('requires a token', async () => {
    expect((await list()).status).toBe(401);
  });

  it.each(['SCHOOL_ADMIN', 'CONTENT_MANAGER', 'STAFF', 'STUDENT', 'PARENT_GUEST'])('rejects %s with 403', async (role) => {
    expect((await list(ids[role])).status).toBe(403);
  });

  it('returns exactly the seeded permissions, with their id, code, description and category', async () => {
    const res = await list(platformAdminId);
    expect(res.status).toBe(200);

    const seeded = await prisma.permission.findMany({ select: { id: true, code: true, description: true } });
    expect(res.body).toHaveLength(seeded.length);
    expect(res.body).toEqual(
      expect.arrayContaining(seeded.map((p) => ({ ...p, category: p.code.split(':')[0] }))),
    );
    // `id` is what PATCH /roles/{id} takes in `permissionIds` (#45), so the catalogue exposes it too.
    for (const permission of res.body) {
      expect(Object.keys(permission).sort()).toEqual(['category', 'code', 'description', 'id']);
      expect(permission.id).toEqual(expect.any(String));
    }
    expect(res.body).toContainEqual({
      code: 'users:invite',
      description: 'Send invitations to new users',
      category: 'users',
      id: expect.any(String),
    });
  });

  it('is sorted by category, then code', async () => {
    const res = await list(platformAdminId);
    expect(res.status).toBe(200);

    // Same two-level comparison the endpoint documents: category first, then code. Comparing a
    // `category|code` string instead would order the legacy dotted codes (`documents.manage`, whose
    // category is the code itself) differently from the per-field sort the API performs.
    const rows = res.body as { category: string; code: string }[];
    const sorted = [...rows].sort(
      (a, b) => a.category.localeCompare(b.category) || a.code.localeCompare(b.code),
    );
    expect(rows.map((row) => row.code)).toEqual(sorted.map((row) => row.code));
  });
});
