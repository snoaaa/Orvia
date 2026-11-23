import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * PATCH /roles/:id (#45) and the role reads it builds on.
 *
 * Covers the whole issue: name/scope/permission edits, base roles refused, permission codes *and* ids,
 * everything validated before anything is written, the assignments of the role stamped for the mobile
 * delta sync, and — the acceptance criterion — a holder of the role being allowed by the new set on
 * their very next request. Also pins the security rules: `system:manage` only on platform roles, no
 * re-scoping of an assigned role, and platform-only authorization on edit/delete.
 */
describe('Role edition (e2e)', () => {
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
  const patch = async (id: string, body: object, as: string) =>
    http().patch(`/roles/${id}`).set('Authorization', await bearer(as)).send(body);
  const deleteRole = async (id: string, as: string) =>
    http().delete(`/identity/roles/${id}`).set('Authorization', await bearer(as));
  const createRole = async (key: string, permissions = ['documents:read', 'rag:query'], scope = 'school') =>
    http()
      .post('/roles')
      .set('Authorization', await bearer(platformAdminId))
      .send({ name: roleName(key), scope, permissions });
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  const codesOf = async (roleId: string) =>
    (
      await prisma.rolePermission.findMany({
        where: { roleId },
        include: { permission: { select: { code: true } } },
      })
    )
      .map((rp) => rp.permission.code)
      .sort();

  async function user(key: string, role: string) {
    const created = await prisma.user.create({
      data: { email: `e2e-roleupdate-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status: 'ACTIVE' },
    });
    const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
    await prisma.userAssignment.create({ data: { userId: created.id, schoolId, roleId: roleRow.id } });
    ids[key] = created.id;
    return created.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    schoolId = (await prisma.school.create({ data: { name: `Test E2E RoleUpdate School ${stamp}` } })).id;
    await user('SchoolAdmin', 'SCHOOL_ADMIN');
    await user('Student', 'STUDENT');

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;

    // The API refuses to create such a role, so it is built straight in the database: a school-scoped
    // role that holds platform administration is exactly what the service-side checks must stop.
    const systemManage = await prisma.permission.findUniqueOrThrow({ where: { code: 'system:manage' } });
    const readUsers = await prisma.permission.findUniqueOrThrow({ where: { code: 'users:assign_role' } });
    const rogueRole = await prisma.role.create({
      data: { id: randomUUID(), name: `E2E_SYS_MANAGER_${stamp}`, scope: 'school' },
    });
    await prisma.rolePermission.createMany({
      data: [
        { roleId: rogueRole.id, permissionId: systemManage.id },
        { roleId: rogueRole.id, permissionId: readUsers.id },
      ],
    });
    const rogueUser = await prisma.user.create({
      data: {
        email: `e2e-roleupdate-sysmanager-${stamp}@school.edu`,
        fullName: 'School System Manager',
        status: 'ACTIVE',
      },
    });
    await prisma.userAssignment.create({ data: { userId: rogueUser.id, schoolId, roleId: rogueRole.id } });
    ids.SysManager = rogueUser.id;
  });

  afterAll(async () => {
    await prisma.role.deleteMany({ where: { name: { contains: `_${stamp}` } } });
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E RoleUpdate School' } } });
    await app.close();
  });

  describe('reading roles with their permissions', () => {
    it('lists roles with codes, ids, holder count and base flag', async () => {
      check(await createRole('READ'), 201);

      const res = check(await http().get('/roles').set('Authorization', await bearer(platformAdminId)), 200);
      const role = res.body.find((r: { name: string }) => r.name === roleName('READ'));
      expect(role).toMatchObject({
        name: roleName('READ'),
        scope: 'school',
        permissions: ['documents:read', 'rag:query'],
        assignedUsersCount: 0,
        isBase: false,
      });
      expect(role.permissionIds).toHaveLength(2);
      expect(role.permissionIds).toEqual(expect.arrayContaining([expect.any(String)]));
    });

    it('serves one role by id and by name, and 404s an unknown one', async () => {
      const created = check(await createRole('ONE'), 201).body;

      for (const key of [created.id, roleName('ONE'), roleName('ONE').toLowerCase()]) {
        const res = check(await http().get(`/roles/${key}`).set('Authorization', await bearer(platformAdminId)), 200);
        expect(res.body).toMatchObject({ id: created.id, name: roleName('ONE') });
        expect(res.body.permissions).toEqual(['documents:read', 'rag:query']);
      }

      check(await http().get('/roles/NOT_A_ROLE').set('Authorization', await bearer(platformAdminId)), 404);
    });

    it('shows a base role and its permissions as read-only', async () => {
      const res = check(await http().get('/roles/STUDENT').set('Authorization', await bearer(platformAdminId)), 200);
      expect(res.body).toMatchObject({ name: 'STUDENT', isBase: true });
      expect(res.body.permissions.length).toBeGreaterThan(0);
      expect(res.body.permissionIds).toHaveLength(res.body.permissions.length);
    });

    it('lets school admins read roles but not edit them', async () => {
      const created = check(await createRole('SCHOOLREAD'), 201).body;

      check(await http().get('/roles').set('Authorization', await bearer(ids.SchoolAdmin)), 200);
      const res = check(
        await patch(created.id, { permissions: ['rag:query'] }, ids.SchoolAdmin),
        403,
      );
      expect(res.body.message).toBe('Missing permission: system:manage');
      expect(await codesOf(created.id)).toEqual(['documents:read', 'rag:query']);
    });

    it('requires a token', async () => {
      check(await http().get('/roles'), 401);
      check(await http().patch('/roles/STUDENT').send({ name: 'X_ROLE' }), 401);
    });
  });

  describe('editing a custom role', () => {
    it('renames it, re-scopes it and replaces its permissions in one PATCH', async () => {
      const created = check(await createRole('EDIT'), 201).body;

      const res = check(
        await patch(
          created.id,
          {
            name: `e2e_role_edited_${stamp}`,
            scope: 'group',
            permissions: ['conversations:create', 'spaces:read'],
          },
          platformAdminId,
        ),
        200,
      );

      expect(res.body).toMatchObject({
        id: created.id,
        name: `E2E_ROLE_EDITED_${stamp}`,
        scope: 'group',
        permissions: ['conversations:create', 'spaces:read'],
        isBase: false,
      });
      expect(await codesOf(created.id)).toEqual(['conversations:create', 'spaces:read']);

      const reread = check(await http().get(`/roles/${created.id}`).set('Authorization', await bearer(platformAdminId)), 200);
      expect(reread.body).toMatchObject({ name: `E2E_ROLE_EDITED_${stamp}`, permissions: ['conversations:create', 'spaces:read'] });
    });

    it('accepts permission ids as well as codes', async () => {
      const created = check(await createRole('IDS'), 201).body;
      const catalogue = check(await http().get('/permissions').set('Authorization', await bearer(platformAdminId)), 200);
      const wanted = ['rag:query', 'spaces:read'];
      const permissionIds = catalogue.body
        .filter((permission: { code: string }) => wanted.includes(permission.code))
        .map((permission: { id: string }) => permission.id);
      expect(permissionIds).toHaveLength(2);

      const res = check(await patch(created.id, { permissionIds }, platformAdminId), 200);

      expect(res.body.permissions).toEqual(wanted);
      expect(await codesOf(created.id)).toEqual(wanted);
    });

    it('accepts upper-case permission ids, which MySQL matches case-insensitively (#45 review)', async () => {
      const created = check(await createRole('IDS_UPPER'), 201).body;
      const catalogue = check(await http().get('/permissions').set('Authorization', await bearer(platformAdminId)), 200);
      const upperIds = catalogue.body
        .filter((permission: { code: string }) => ['rag:query', 'spaces:read'].includes(permission.code))
        .map((permission: { id: string }) => permission.id.toUpperCase());
      expect(upperIds).toHaveLength(2);

      const res = check(await patch(created.id, { permissionIds: upperIds }, platformAdminId), 200);

      expect(res.body.permissions).toEqual(['rag:query', 'spaces:read']);
      expect(await codesOf(created.id)).toEqual(['rag:query', 'spaces:read']);
    });

    it('keeps permissionIds aligned with permissions, including for dotted codes (#45 review)', async () => {
      // `documents.access.manage` and `documents:access.manage` order differently under UTF-16 `.sort()`
      // than under `localeCompare`, which is how the two arrays drifted apart.
      const res = check(
        await http().get('/roles/SCHOOL_ADMIN').set('Authorization', await bearer(platformAdminId)),
        200,
      );
      const { permissions, permissionIds } = res.body as { permissions: string[]; permissionIds: string[] };
      expect(permissions.length).toBeGreaterThan(10);
      expect(permissionIds).toHaveLength(permissions.length);

      const catalogue = check(await http().get('/permissions').set('Authorization', await bearer(platformAdminId)), 200);
      const idByCode = new Map<string, string>(
        (catalogue.body as Array<{ id: string; code: string }>).map((permission) => [permission.code, permission.id]),
      );
      permissions.forEach((code, index) => {
        expect({ code, id: permissionIds[index] }).toEqual({ code, id: idByCode.get(code) });
      });
      expect(permissions).toEqual([...permissions].sort());
    });

    it('clears the permission set with an empty array', async () => {
      const created = check(await createRole('CLEAR'), 201).body;

      const res = check(await patch(created.id, { permissions: [] }, platformAdminId), 200);

      expect(res.body.permissions).toEqual([]);
      expect(await codesOf(created.id)).toEqual([]);
    });

    it('writes nothing when the payload changes nothing', async () => {
      const created = check(await createRole('NOOP'), 201).body;

      const res = check(await patch(created.id, { permissions: ['documents:read', 'rag:query'] }, platformAdminId), 200);

      expect(res.body.permissions).toEqual(['documents:read', 'rag:query']);
      expect(await codesOf(created.id)).toEqual(['documents:read', 'rag:query']);
    });

    it('records the permission diff in the audit trail', async () => {
      const created = check(await createRole('AUDIT'), 201).body;
      check(await patch(created.id, { permissions: ['rag:query'] }, platformAdminId), 200);

      const event = await prisma.auditEvent.findFirst({
        where: { action: 'role_updated', entityId: created.id },
        orderBy: { seq: 'desc' },
      });
      expect(event).not.toBeNull();
      expect(event?.category).toBe('identity_access');
      expect(event?.entityType).toBe('role');
      expect(event?.details).toMatchObject({
        role: roleName('AUDIT'),
        permissions: ['rag:query'],
        addedPermissions: [],
        removedPermissions: ['documents:read'],
      });
    });
  });

  describe('mobile sync and next-request permissions', () => {
    it('stamps the assignments of the role and applies the new set on the next request', async () => {
      const created = check(await createRole('HOLDER', ['documents:read']), 201).body;
      const holderId = await user('Holder', 'STAFF');
      await prisma.userAssignment.deleteMany({ where: { userId: holderId } });
      const assignment = await prisma.userAssignment.create({
        data: { userId: holderId, schoolId, roleId: created.id },
      });
      // Start from an old stamp, so "the sync picks it up" is observable.
      const longAgo = new Date(Date.now() - 60 * 60 * 1000);
      await prisma.userAssignment.update({ where: { id: assignment.id }, data: { updatedAt: longAgo } });

      const before = check(await http().get('/auth/me').set('Authorization', await bearer(holderId)), 200);
      expect(before.body.permissions).not.toContain('rag:query');

      check(await patch(created.id, { permissions: ['rag:query', 'spaces:read'] }, platformAdminId), 200);

      const after = check(await http().get('/auth/me').set('Authorization', await bearer(holderId)), 200);
      expect(after.body.permissions).toEqual(expect.arrayContaining(['rag:query', 'spaces:read']));
      expect(after.body.permissions).not.toContain('documents:read');

      const touched = await prisma.userAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
      expect(touched.updatedAt.getTime()).toBeGreaterThan(longAgo.getTime());
    });
  });

  describe('refused changes', () => {
    it.each(['PLATFORM_ADMIN', 'SCHOOL_ADMIN', 'CONTENT_MANAGER', 'STAFF', 'STUDENT', 'PARENT_GUEST'])(
      'refuses to edit the base role %s',
      async (name) => {
        const before = await prisma.role.findUniqueOrThrow({ where: { name } });
        const res = check(await patch(before.id, { name: `E2E_NOT_${name}_${stamp}` }, platformAdminId), 400);

        expect(res.body.message).toBe('System base roles cannot be edited');
        expect((await prisma.role.findUniqueOrThrow({ where: { id: before.id } })).name).toBe(name);
      },
    );

    it('refuses to rename a custom role to a base role name', async () => {
      const created = check(await createRole('RESERVED'), 201).body;

      const res = check(await patch(created.id, { name: 'school_admin' }, platformAdminId), 400);

      expect(res.body.message).toBe("Role name 'SCHOOL_ADMIN' is reserved for system base roles");
    });

    it('refuses a name already taken, ignoring case', async () => {
      const first = check(await createRole('TAKEN_A'), 201).body;
      check(await createRole('TAKEN_B'), 201);

      const res = check(
        await patch(first.id, { name: roleName('TAKEN_B').toLowerCase() }, platformAdminId),
        409,
      );
      expect(res.body.message).toBe(`Role '${roleName('TAKEN_B')}' already exists`);
    });

    it.each<[string, Record<string, unknown>, string | null]>([
      ['an empty body', {}, 'Nothing to update: send name, scope, permissions or permissionIds'],
      [
        'both permission spellings',
        { permissions: ['rag:query'], permissionIds: ['00000000-0000-4000-8000-000000000000'] },
        'Send either permissions (codes) or permissionIds (ids), not both',
      ],
      [
        'an unknown code',
        { permissions: ['documents:read', 'documents:teleport'] },
        'Unknown permission code(s): documents:teleport',
      ],
      ['an unknown id', { permissionIds: ['00000000-0000-4000-8000-000000000000'] }, null],
      ['an unknown scope', { scope: 'class' }, null],
      ['a permission list that is not a string array', { permissions: [1, 2] }, null],
      ['a name that is too short', { name: 'A' }, null],
      ['a name with spaces', { name: 'TWO WORDS' }, null],
      ['an unexpected field', { isBase: true }, null],
    ])('rejects %s with a 400 and writes nothing', async (label, body, message) => {
      const created = check(await createRole(`BAD_${label.replace(/\W+/g, '_').slice(0, 20)}`), 201).body;
      const before = await prisma.role.findUniqueOrThrow({ where: { id: created.id } });

      const res = check(await patch(created.id, body, platformAdminId), 400);

      if (message) expect(res.body.message).toBe(message);
      const after = await prisma.role.findUniqueOrThrow({ where: { id: created.id } });
      expect(after.name).toBe(before.name);
      expect(after.scope).toBe(before.scope);
      expect(await codesOf(created.id)).toEqual(['documents:read', 'rag:query']);
    });

    it.each<[string, Record<string, unknown>]>([
      ['name', { name: null }],
      ['scope', { scope: null }],
      ['permissions', { permissions: null }],
      ['permissionIds', { permissionIds: null }],
    ])('rejects a null %s instead of crashing or wiping the set (#45 review)', async (label, body) => {
      const created = check(await createRole(`NULL_${label.toUpperCase()}`), 201).body;

      check(await patch(created.id, body, platformAdminId), 400);

      // The whole point: the role is untouched, not rewritten with null/[].
      const after = await prisma.role.findUniqueOrThrow({ where: { id: created.id } });
      expect(after.name).toBe(roleName(`NULL_${label.toUpperCase()}`));
      expect(after.scope).toBe('school');
      expect(await codesOf(created.id)).toEqual(['documents:read', 'rag:query']);
    });

    it('rejects padded duplicates, which trimming turns into real duplicates (#45 review)', async () => {
      const created = check(await createRole('PADDED_DUP'), 201).body;

      check(await patch(created.id, { permissions: ['documents:read', ' documents:read '] }, platformAdminId), 400);
      expect(await codesOf(created.id)).toEqual(['documents:read', 'rag:query']);
    });

    it('answers 404 for an unknown role', async () => {
      check(await patch('00000000-0000-4000-8000-000000000000', { permissions: [] }, platformAdminId), 404);
    });

    it.each<[string, string[]]>([
      ['a blank code', ['']],
      ['a whitespace-only code', ['   ']],
      ['a blank code mixed with a real one', ['', 'rag:query']],
      ['an over-long code', ['x'.repeat(101)]],
    ])('rejects %s with a 400 and keeps the current permissions', async (label, permissions) => {
      const created = check(await createRole(`BLANK_${label.replace(/\W+/g, '_').slice(0, 20)}`), 201).body;

      check(await patch(created.id, { permissions }, platformAdminId), 400);
      expect(await codesOf(created.id)).toEqual(['documents:read', 'rag:query']);
    });
  });

  describe('security rules', () => {
    it.each(['school', 'group'])('refuses system:manage on a %s-scoped role at creation', async (scope) => {
      const res = check(
        await http()
          .post('/roles')
          .set('Authorization', await bearer(platformAdminId))
          .send({ name: `E2E_ROLE_SCOPED_${scope}_${stamp}`, scope, permissions: ['system:manage'] }),
        400,
      );
      expect(res.body.message).toBe('A role that grants system:manage must have the platform scope');
      expect(await prisma.role.count({ where: { name: `E2E_ROLE_SCOPED_${scope}_${stamp}` } })).toBe(0);
    });

    it('accepts system:manage on a platform-scoped role', async () => {
      const res = check(
        await http()
          .post('/roles')
          .set('Authorization', await bearer(platformAdminId))
          .send({ name: `E2E_ROLE_PLATFORM_${stamp}`, scope: 'platform', permissions: ['system:manage'] }),
        201,
      );
      expect(res.body).toMatchObject({ scope: 'platform', permissions: ['system:manage'] });
    });

    it('refuses to grant system:manage to a school role through PATCH', async () => {
      const created = check(await createRole('ESCALATE'), 201).body;

      const patched = check(await patch(created.id, { permissions: ['system:manage'] }, platformAdminId), 400);
      expect(patched.body.message).toBe('A role that grants system:manage must have the platform scope');

      expect(await codesOf(created.id)).toEqual(['documents:read', 'rag:query']);
    });

    it('refuses to re-scope a role that still has assignments', async () => {
      const created = check(await createRole('ASSIGNED'), 201).body;
      const holderId = await user('AssignedHolder', 'STAFF');
      await prisma.userAssignment.deleteMany({ where: { userId: holderId } });
      await prisma.userAssignment.create({ data: { userId: holderId, schoolId, roleId: created.id } });

      const res = check(await patch(created.id, { scope: 'platform' }, platformAdminId), 400);
      expect(res.body.message).toContain('still assigned to 1 user(s)');
      expect((await prisma.role.findUniqueOrThrow({ where: { id: created.id } })).scope).toBe('school');
    });

    it('allows re-scoping a role that nobody holds', async () => {
      const created = check(await createRole('UNASSIGNED'), 201).body;

      const res = check(await patch(created.id, { scope: 'group' }, platformAdminId), 200);

      expect(res.body.scope).toBe('group');
    });

    it('cannot re-scope a role to platform while an assignment to it is being created (#45 review)', async () => {
      const created = check(await createRole('RACE'), 201).body;
      const holderId = await user('RaceHolder', 'STAFF');
      // Free the seeded STAFF assignment so the concurrent POST /assignments can insert this role.
      await prisma.userAssignment.deleteMany({ where: { userId: holderId } });

      const auth = await bearer(platformAdminId);
      const [patched, assigned] = await Promise.all([
        http().patch(`/roles/${created.id}`).set('Authorization', auth).send({ scope: 'platform' }),
        http()
          .post('/assignments')
          .set('Authorization', auth)
          .send({ userId: holderId, schoolId, role: roleName('RACE') }),
      ]);

      // Both lock the roles row, so exactly one of them can win: either the re-scope sees the new
      // assignment (400) or the assignment sees the new scope (409).
      const winners = [patched.status, assigned.status].filter((status) => status < 300);
      expect(winners).toHaveLength(1);

      const role = await prisma.role.findUniqueOrThrow({ where: { id: created.id } });
      const activeAssignments = await prisma.userAssignment.count({
        where: { roleId: created.id, deletedAt: null },
      });
      // The invariant the race used to break: a platform-scoped role never carries a school assignment.
      expect(role.scope === 'platform' && activeAssignments > 0).toBe(false);
    });

    it('cannot re-scope a role to platform while PATCH /assignments/:id assigns it', async () => {
      const created = check(await createRole('RACE_PATCH_ASSIGNMENT'), 201).body;
      const holderId = await user('RacePatchAssign', 'STAFF');
      const assignment = await prisma.userAssignment.findFirstOrThrow({
        where: { userId: holderId, schoolId, deletedAt: null },
      });

      const auth = await bearer(platformAdminId);
      const [patched, updatedAssignment] = await Promise.all([
        http().patch(`/roles/${created.id}`).set('Authorization', auth).send({ scope: 'platform' }),
        http().patch(`/assignments/${assignment.id}`).set('Authorization', auth).send({ role: roleName('RACE_PATCH_ASSIGNMENT') }),
      ]);

      const winners = [patched.status, updatedAssignment.status].filter((status) => status < 300);
      expect(winners).toHaveLength(1);
      const role = await prisma.role.findUniqueOrThrow({ where: { id: created.id } });
      const activeAssignments = await prisma.userAssignment.count({
        where: { roleId: created.id, deletedAt: null },
      });
      expect(role.scope === 'platform' && activeAssignments > 0).toBe(false);
    });

    it('cannot re-scope a role to platform while PATCH /identity/users/:id/role assigns it', async () => {
      const created = check(await createRole('RACE_IDENTITY_ROLE'), 201).body;
      const holderId = await user('RaceIdentityRole', 'STAFF');

      const auth = await bearer(platformAdminId);
      const [patched, assigned] = await Promise.all([
        http().patch(`/roles/${created.id}`).set('Authorization', auth).send({ scope: 'platform' }),
        http()
          .patch(`/identity/users/${holderId}/role`)
          .set('Authorization', auth)
          .send({ schoolId, role: roleName('RACE_IDENTITY_ROLE') }),
      ]);

      const winners = [patched.status, assigned.status].filter((status) => status < 300);
      expect(winners).toHaveLength(1);
      const role = await prisma.role.findUniqueOrThrow({ where: { id: created.id } });
      const activeAssignments = await prisma.userAssignment.count({
        where: { roleId: created.id, deletedAt: null },
      });
      expect(role.scope === 'platform' && activeAssignments > 0).toBe(false);
    });

    it('counts distinct users rather than per-school assignment rows in GET /roles and scope-change refusal', async () => {
      const created = check(await createRole('MULTI_SCHOOL_USER'), 201).body;
      const secondSchool = await prisma.school.create({
        data: { name: `Test E2E RoleUpdate School Second ${stamp}` },
      });
      const holderId = await user('MultiSchoolHolder', 'STAFF');
      await prisma.userAssignment.deleteMany({ where: { userId: holderId } });
      await prisma.userAssignment.createMany({
        data: [
          { userId: holderId, schoolId, roleId: created.id },
          { userId: holderId, schoolId: secondSchool.id, roleId: created.id },
        ],
      });

      const readRes = check(await http().get(`/roles/${created.id}`).set('Authorization', await bearer(platformAdminId)), 200);
      expect(readRes.body.assignedUsersCount).toBe(1);

      const patchRes = check(await patch(created.id, { scope: 'platform' }, platformAdminId), 400);
      expect(patchRes.body.message).toContain('still assigned to 1 user(s)');
    });

    it('rejects mixed-case duplicate permissionIds with 400', async () => {
      const created = check(await createRole('MIXED_CASE_UUIDS'), 201).body;
      const permsRes = check(await http().get('/permissions').set('Authorization', await bearer(platformAdminId)), 200);
      const firstId = String(permsRes.body[0].id);

      check(
        await patch(created.id, { permissionIds: [firstId.toLowerCase(), firstId.toUpperCase()] }, platformAdminId),
        400,
      );
      expect(await codesOf(created.id)).toEqual(['documents:read', 'rag:query']);
    });

    it('refuses a school-scoped system:manage holder before revealing anything', async () => {
      const base = await prisma.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });
      const custom = check(await createRole('GUARDED'), 201).body;

      for (const target of [base.id, custom.id, 'DOES_NOT_EXIST']) {
        const res = check(await patch(target, { name: 'RENAMED_BY_SCHOOL' }, ids.SysManager), 403);
        expect(res.body.message).toBe('Only platform administrators may edit roles');
      }
      check(await deleteRole(custom.id, ids.SysManager), 403);
      expect(await prisma.role.count({ where: { id: custom.id } })).toBe(1);
    });

    it('still lets that holder read the roles', async () => {
      check(await http().get('/roles').set('Authorization', await bearer(ids.SysManager)), 200);
    });
  });
});
