import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** POST /roles (#44): only platform admins create roles; unique names; scope and permission codes validated. */
describe('Role creation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const roleName = (key: string) => `E2E_ROLE_${key}_${stamp}`;
  const ids: Record<string, string> = {};
  let schoolId: string;
  let platformAdminId: string;

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const create = async (as: string, body: object, path = '/roles') =>
    http().post(path).set('Authorization', await bearer(as)).send(body);
  const valid = (key: string) => ({ name: roleName(key), scope: 'school', permissions: ['documents:read', 'rag:query'] });
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  const roleExists = async (name: string) => (await prisma.role.count({ where: { name } })) > 0;

  async function user(key: string, role: string) {
    const created = await prisma.user.create({
      data: { email: `e2e-rolecreate-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status: 'ACTIVE' },
    });
    const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
    await prisma.userAssignment.create({ data: { userId: created.id, schoolId, roleId: roleRow.id } });
    ids[key] = created.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    schoolId = (await prisma.school.create({ data: { name: `Test E2E RoleCreate School ${stamp}` } })).id;
    await user('SchoolAdmin', 'SCHOOL_ADMIN');
    await user('ContentManager', 'CONTENT_MANAGER');
    await user('Staff', 'STAFF');
    await user('Student', 'STUDENT');

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    // role_permissions rows go with their role (ON DELETE CASCADE).
    await prisma.role.deleteMany({ where: { name: { contains: `_${stamp}` } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E RoleCreate School' } } });
    await app.close();
  });

  describe('access', () => {
    it('requires a token', async () => {
      check(await http().post('/roles').send(valid('NoToken')), 401);
      expect(await roleExists(roleName('NoToken'))).toBe(false);
    });

    it.each(['SchoolAdmin', 'ContentManager', 'Staff', 'Student'])('rejects %s (not a platform admin)', async (key) => {
      const res = check(await create(ids[key], valid(key.toUpperCase())), 403);
      expect(res.body.message).toBe('Missing permission: system:manage');
      expect(await roleExists(roleName(key.toUpperCase()))).toBe(false);
    });
  });

  describe('as the platform admin', () => {
    it('creates the role with its scope and permissions', async () => {
      const res = check(
        await create(platformAdminId, {
          name: `e2e_role_assistant_${stamp}`,
          scope: 'group',
          permissions: ['rag:query', 'documents:read'],
        }),
        201,
      );

      expect(res.body).toMatchObject({
        id: expect.any(String),
        name: roleName('ASSISTANT'),
        scope: 'group',
        permissions: ['documents:read', 'rag:query'],
        assignedUsersCount: 0,
        isBase: false,
      });
      const stored = await prisma.role.findUniqueOrThrow({
        where: { id: res.body.id },
        include: { rolePermissions: { include: { permission: true } } },
      });
      expect(stored.name).toBe(roleName('ASSISTANT'));
      expect(stored.rolePermissions.map((rp) => rp.permission.code).sort()).toEqual(['documents:read', 'rag:query']);
    });

    it('lists the new role in GET /identity/roles', async () => {
      check(await create(platformAdminId, valid('LISTED')), 201);
      const res = check(await http().get('/identity/roles').set('Authorization', await bearer(platformAdminId)), 200);
      expect(res.body.map((r: { name: string }) => r.name)).toContain(roleName('LISTED'));
    });

    it('rejects a duplicate name, ignoring case and spaces', async () => {
      check(await create(platformAdminId, valid('DUP')), 201);

      for (const name of [roleName('DUP'), roleName('DUP').toLowerCase(), `  ${roleName('DUP')}  `]) {
        const res = check(await create(platformAdminId, { ...valid('DUP'), name }), 409);
        expect(res.body.message).toBe(`Role '${roleName('DUP')}' already exists`);
      }
      expect(await prisma.role.count({ where: { name: roleName('DUP') } })).toBe(1);
    });

    it('creates only one role when two identical requests race', async () => {
      const [a, b] = await Promise.all([create(platformAdminId, valid('RACE')), create(platformAdminId, valid('RACE'))]);
      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
      expect(await prisma.role.count({ where: { name: roleName('RACE') } })).toBe(1);
    });

    it.each(['PLATFORM_ADMIN', 'school_admin', 'Student'])('rejects the base role name %s', async (name) => {
      const res = check(await create(platformAdminId, { ...valid('X'), name }), 400);
      expect(res.body.message).toBe(`Role name '${name.toUpperCase()}' is reserved for system base roles`);
    });

    it('rejects unknown permission codes and creates nothing', async () => {
      const res = check(
        await create(platformAdminId, { ...valid('UNKNOWN'), permissions: ['documents:read', 'documents:teleport'] }),
        400,
      );
      expect(res.body.message).toBe('Unknown permission code(s): documents:teleport');
      expect(await roleExists(roleName('UNKNOWN'))).toBe(false);
    });

    it.each([
      ['an unknown scope', { scope: 'class' }],
      ['an empty permission list', { permissions: [] }],
      ['a repeated permission', { permissions: ['documents:read', 'documents:read'] }],
      ['permissions that are not strings', { permissions: [1, 2] }],
      ['a name with spaces', { name: 'TEACHING ASSISTANT' }],
      ['a one-letter name', { name: 'A' }],
      ['a name over 50 characters', { name: 'R'.repeat(51) }],
      ['an unexpected field', { isBase: true }],
    ])('rejects %s (400)', async (_label, override) => {
      check(await create(platformAdminId, { ...valid('INVALID'), ...override }), 400);
      expect(await roleExists(roleName('INVALID'))).toBe(false);
    });

    it.each(['name', 'scope', 'permissions'])('requires %s (400)', async (field) => {
      const body: Record<string, unknown> = valid('MISSING');
      delete body[field];
      check(await create(platformAdminId, body), 400);
    });
  });

  describe('older path POST /identity/roles', () => {
    it('applies the same rules', async () => {
      check(await create(platformAdminId, valid('LEGACY'), '/identity/roles'), 201);
      check(await create(platformAdminId, valid('LEGACY'), '/identity/roles'), 409);
      check(await create(ids.SchoolAdmin, valid('LEGACY2'), '/identity/roles'), 403);
      check(await create(platformAdminId, { ...valid('LEGACY3'), permissions: ['nope'] }, '/identity/roles'), 400);
      expect(await roleExists(roleName('LEGACY2'))).toBe(false);
      expect(await roleExists(roleName('LEGACY3'))).toBe(false);
    });
  });
});
