import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * DELETE /roles/:id (#46): removing an unused custom role.
 *
 * The issue's acceptance criteria are the spine of this file: base roles are never deleted, a role
 * still held by users is refused with the count in the message, only platform admins may delete, and a
 * successful delete is audited. The older `/identity/roles/:id` path must behave identically.
 */
describe('Role deletion (e2e)', () => {
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
  const remove = async (id: string, as: string) =>
    http().delete(`/roles/${id}`).set('Authorization', await bearer(as));
  const removeLegacy = async (id: string, as: string) =>
    http().delete(`/identity/roles/${id}`).set('Authorization', await bearer(as));
  const createRole = async (key: string, permissions = ['documents:read', 'rag:query']) =>
    http()
      .post('/roles')
      .set('Authorization', await bearer(platformAdminId))
      .send({ name: roleName(key), scope: 'school', permissions });
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  const roleExists = async (id: string) => (await prisma.role.count({ where: { id } })) > 0;

  async function user(key: string, role: string) {
    const created = await prisma.user.create({
      data: { email: `e2e-roledelete-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status: 'ACTIVE' },
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

    schoolId = (await prisma.school.create({ data: { name: `Test E2E RoleDelete School ${stamp}` } })).id;
    await user('SchoolAdmin', 'SCHOOL_ADMIN');
    await user('ContentManager', 'CONTENT_MANAGER');
    await user('Student', 'STUDENT');

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;

    // The API refuses to create such a role, so it is built straight in the database: a school-scoped
    // role holding platform administration is what the service-side check must stop from deleting.
    const systemManage = await prisma.permission.findUniqueOrThrow({ where: { code: 'system:manage' } });
    const rogueRole = await prisma.role.create({
      data: { id: randomUUID(), name: `E2E_SYS_MANAGER_${stamp}`, scope: 'school' },
    });
    await prisma.rolePermission.create({ data: { roleId: rogueRole.id, permissionId: systemManage.id } });
    const rogueUser = await prisma.user.create({
      data: {
        email: `e2e-roledelete-sysmanager-${stamp}@school.edu`,
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
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E RoleDelete School' } } });
    await app.close();
  });

  describe('access', () => {
    it('requires a token', async () => {
      check(await http().delete('/roles/PARENT_GUEST'), 401);
    });

    it.each(['SchoolAdmin', 'ContentManager', 'Student'])('rejects %s with 403', async (key) => {
      const created = check(await createRole(`DENIED_${key}`), 201).body;

      const res = check(await remove(created.id, ids[key]), 403);
      expect(res.body.message).toBe('Missing permission: system:manage');
      expect(await roleExists(created.id)).toBe(true);
    });

    it('refuses a school-scoped system:manage holder with the service-level 403', async () => {
      const created = check(await createRole('DENIED_SYS_MANAGER'), 201).body;

      const res = check(await remove(created.id, ids.SysManager), 403);
      expect(res.body.message).toBe('Only platform administrators may delete roles');
      expect(await roleExists(created.id)).toBe(true);
    });
  });

  describe('as the platform admin', () => {
    it('deletes an unused custom role, by id and by name', async () => {
      const byId = check(await createRole('DELETE_ID'), 201).body;
      const byName = check(await createRole('DELETE_NAME'), 201).body;

      const res = check(await remove(byId.id, platformAdminId), 200);
      expect(res.body).toEqual({
        success: true,
        message: `Role '${roleName('DELETE_ID')}' was successfully deleted`,
      });
      expect(await roleExists(byId.id)).toBe(false);

      // `{id}` also accepts the role name, case-insensitively.
      check(await remove(roleName('DELETE_NAME').toLowerCase(), platformAdminId), 200);
      expect(await roleExists(byName.id)).toBe(false);

      // The role is gone from the listing too, and a second delete is a 404.
      const list = check(
        await http().get('/identity/roles').set('Authorization', await bearer(platformAdminId)),
        200,
      );
      expect(list.body.map((r: { id: string }) => r.id)).not.toContain(byId.id);
      check(await remove(byId.id, platformAdminId), 404);
    });

    it('records the deletion in the audit trail', async () => {
      const created = check(await createRole('AUDIT'), 201).body;

      check(await remove(created.id, platformAdminId), 200);

      const event = await prisma.auditEvent.findFirst({
        where: { action: 'role_deleted', entityId: created.id },
        orderBy: { seq: 'desc' },
      });
      expect(event).not.toBeNull();
      expect(event?.category).toBe('identity_access');
      expect(event?.entityType).toBe('role');
      expect(event?.details).toMatchObject({
        role: roleName('AUDIT'),
        scope: 'school',
        documentAccessRulesRemoved: 0,
      });
    });

    it.each(['PLATFORM_ADMIN', 'SCHOOL_ADMIN', 'CONTENT_MANAGER', 'STAFF', 'STUDENT', 'PARENT_GUEST'])(
      'refuses to delete the base role %s',
      async (name) => {
        const base = await prisma.role.findUniqueOrThrow({ where: { name } });

        const res = check(await remove(base.id, platformAdminId), 400);

        expect(res.body.message).toBe('System base roles cannot be deleted');
        expect(await roleExists(base.id)).toBe(true);
      },
    );

    it('refuses a role still assigned to users and says how many', async () => {
      const created = check(await createRole('ASSIGNED'), 201).body;
      const first = await user('AssignedOne', 'STAFF');
      const second = await user('AssignedTwo', 'STAFF');
      await prisma.userAssignment.deleteMany({ where: { userId: { in: [first, second] } } });
      await prisma.userAssignment.createMany({
        data: [
          { userId: first, schoolId, roleId: created.id },
          { userId: second, schoolId, roleId: created.id },
        ],
      });

      const res = check(await remove(created.id, platformAdminId), 400);
      expect(res.body.message).toBe(
        `Cannot delete role '${roleName('ASSIGNED')}': still assigned to 2 user(s). Please reassign them before deleting.`,
      );
      expect(await roleExists(created.id)).toBe(true);
      // The holders keep their access: nothing was written.
      expect(await prisma.userAssignment.count({ where: { roleId: created.id, deletedAt: null } })).toBe(2);
    });

    it('deletes the role once its assignments are gone', async () => {
      const created = check(await createRole('REASSIGNED'), 201).body;
      const holder = await user('Reassigned', 'STAFF');
      await prisma.userAssignment.deleteMany({ where: { userId: holder } });
      const assignment = await prisma.userAssignment.create({
        data: { userId: holder, schoolId, roleId: created.id },
      });

      check(await remove(created.id, platformAdminId), 400);

      // Soft-delete the assignment (what DELETE /assignments/:id does), then the role can go.
      await prisma.userAssignment.update({ where: { id: assignment.id }, data: { deletedAt: new Date() } });
      check(await remove(created.id, platformAdminId), 200);
      expect(await roleExists(created.id)).toBe(false);
    });

    it('answers 404 for an unknown role', async () => {
      check(await remove('00000000-0000-4000-8000-000000000000', platformAdminId), 404);
      check(await remove('NOT_A_ROLE', platformAdminId), 404);
    });

    it('counts distinct users, so one person in two schools is one user (#46 review)', async () => {
      const created = check(await createRole('TWO_SCHOOLS'), 201).body;
      const other = await prisma.school.create({ data: { name: `Test E2E RoleDelete School 2 ${stamp}` } });
      const holder = await user('TwoSchools', 'STAFF');
      await prisma.userAssignment.deleteMany({ where: { userId: holder } });
      await prisma.userAssignment.createMany({
        data: [
          { userId: holder, schoolId, roleId: created.id },
          { userId: holder, schoolId: other.id, roleId: created.id },
        ],
      });

      const res = check(await remove(created.id, platformAdminId), 400);

      // Two assignment rows, one user.
      expect(res.body.message).toBe(
        `Cannot delete role '${roleName('TWO_SCHOOLS')}': still assigned to 1 user(s). Please reassign them before deleting.`,
      );
      await prisma.school.deleteMany({ where: { id: other.id } });
    });

    it('answers one 200 and one 404 when two deletes run at the same time, with a single audit row (#46 review)', async () => {
      const created = check(await createRole('CONCURRENT'), 201).body;
      const auth = await bearer(platformAdminId);

      const [first, second] = await Promise.all([
        http().delete(`/roles/${created.id}`).set('Authorization', auth),
        http().delete(`/roles/${created.id}`).set('Authorization', auth),
      ]);

      expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 404]);
      expect(await prisma.auditEvent.count({ where: { action: 'role_deleted', entityId: created.id } })).toBe(1);
      expect(await roleExists(created.id)).toBe(false);
    });

    it('cannot be raced by an assignment being created against the role (#46 review)', async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const created = check(await createRole(`RACE_${attempt}`), 201).body;
        const holder = await user(`RaceDelete${attempt}`, 'STAFF');
        await prisma.userAssignment.deleteMany({ where: { userId: holder } });
        const auth = await bearer(platformAdminId);

        const [deleted, assigned] = await Promise.all([
          http().delete(`/roles/${created.id}`).set('Authorization', auth),
          http()
            .post('/assignments')
            .set('Authorization', auth)
            .send({ userId: holder, schoolId, role: roleName(`RACE_${attempt}`) }),
        ]);

        // Neither request may 500: the loser gets 400/404/409 and the winner is clean.
        expect([deleted.status, assigned.status].filter((status) => status >= 500)).toEqual([]);
        expect([deleted.status, assigned.status].filter((status) => status < 300)).toHaveLength(1);

        const roleGone = (await roleExists(created.id)) === false;
        const activeAssignments = await prisma.userAssignment.count({
          where: { roleId: created.id, deletedAt: null },
        });
        // Either the role went (and no assignment survived it) or the assignment won and the role stayed.
        expect(roleGone ? activeAssignments : 0).toBe(0);
      }
    });
  });

  describe('older path DELETE /identity/roles/:id', () => {
    it('applies the same rules', async () => {
      const created = check(await createRole('LEGACY'), 201).body;
      const base = await prisma.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });

      // 403 for a non-platform admin, 400 for a base role, 404 for an unknown one...
      check(await removeLegacy(created.id, ids.SchoolAdmin), 403);
      check(await removeLegacy(base.id, platformAdminId), 400);
      check(await removeLegacy('NOT_A_ROLE', platformAdminId), 404);

      // ...and 200 for the custom role.
      const res = check(await removeLegacy(created.id, platformAdminId), 200);
      expect(res.body.success).toBe(true);
      expect(await roleExists(created.id)).toBe(false);
    });
  });
});
