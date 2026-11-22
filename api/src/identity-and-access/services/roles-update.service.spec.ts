import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser, AuthRoleAssignment } from '../../auth/types/authenticated-user.js';
import type { UpdateRoleDto } from '../dto/index.js';
import { IdentityAndAccessService } from './identity-and-access.service.js';

/**
 * PATCH /roles/:id (#45): editing a custom role, its scope and its permission set.
 *
 * The interesting part is not the field plumbing but what must happen around it: base roles are
 * immutable, an unknown permission (code or id) writes nothing, the assignments of the role get a new
 * `updated_at` for the mobile delta sync, and the change is audited with its permission diff.
 */
describe('IdentityAndAccessService - update role (#45)', () => {
  const actorWith = (assignment: AuthRoleAssignment): AuthenticatedUser => ({
    id: 'actor',
    email: 'actor@school.edu',
    fullName: 'Actor',
    status: 'ACTIVE',
    assignments: [assignment],
    permissions: assignment.permissions,
    schoolIds: [assignment.schoolId],
    isPlatformAdmin: assignment.scope === 'platform',
    role: assignment.role,
    schoolId: assignment.schoolId,
    sessionId: null,
  });
  const platformAdmin = actorWith({
    role: 'PLATFORM_ADMIN',
    scope: 'platform',
    schoolId: 'sys',
    groupId: null,
    permissions: ['system:manage'],
  });
  const schoolAdmin = actorWith({
    role: 'SCHOOL_ADMIN',
    scope: 'school',
    schoolId: 'school-1',
    groupId: null,
    permissions: ['users:assign_role'],
  });

  const catalogue = [
    { id: 'p-read', code: 'documents:read' },
    { id: 'p-chat', code: 'conversations:create' },
    { id: 'p-rag', code: 'rag:query' },
    { id: 'p-manage', code: 'system:manage' },
  ];
  /** A school-scoped role that (wrongly) holds platform administration, built straight in the database. */
  const schoolScopedAdmin = actorWith({
    role: 'SCHOOL_SYS_MANAGER',
    scope: 'school',
    schoolId: 'school-1',
    groupId: null,
    permissions: ['system:manage'],
  });
  const dto = (overrides: Partial<UpdateRoleDto> = {}): UpdateRoleDto => ({ ...overrides });

  /** The role as Prisma returns it with its current permission set. */
  const roleRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'role-1',
    name: 'TEACHING_ASSISTANT',
    scope: 'school',
    rolePermissions: [{ permission: { id: 'p-read', code: 'documents:read' } }],
    assignments: [],
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    updatedAt: new Date('2026-11-01T10:00:00.000Z'),
    ...overrides,
  });

  function setup() {
    const update = vi.fn().mockResolvedValue({});
    const remove = vi.fn().mockResolvedValue({});
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const count = vi.fn().mockResolvedValue(0);

    const prisma = {
      role: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        update,
        delete: remove,
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      rolePermission: { deleteMany, createMany },
      permission: {
        findMany: vi.fn(async ({ where }: { where: { code?: { in: string[] }; id?: { in: string[] } } }) =>
          catalogue.filter((p) =>
            where.code ? where.code.in.includes(p.code) : (where.id?.in ?? []).includes(p.id),
          ),
        ),
      },
      userAssignment: { updateMany, count },
      // The role row is locked and resolved in one statement, inside the transaction (#45 review).
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'role-1' }]),
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };

    const audit = { record: vi.fn().mockResolvedValue(undefined) };

    const service = new IdentityAndAccessService(
      prisma as never,
      audit as never,
      {} as never,
      {} as never,
    );

    return { service, prisma, audit, update, remove, deleteMany, createMany, updateMany, count };
  }

  it('renames a custom role, in upper case, and returns it with its permissions', async () => {
    const { service, prisma, update } = setup();
    prisma.role.findFirst
      .mockResolvedValueOnce(roleRow())
      .mockResolvedValueOnce(roleRow({ name: 'TEACHING_ASSISTANT_2' }));

    const result = await service.updateRole('role-1', dto({ name: 'teaching_assistant_2' }), platformAdmin);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'role-1' },
      data: { name: 'TEACHING_ASSISTANT_2' },
    });
    expect(result.name).toBe('TEACHING_ASSISTANT_2');
    expect(result.permissions).toEqual(['documents:read']);
    expect(result.permissionIds).toEqual(['p-read']);
  });

  it('replaces the permission set from codes', async () => {
    const { service, prisma, deleteMany, createMany } = setup();
    prisma.role.findFirst
      .mockResolvedValueOnce(roleRow())
      .mockResolvedValueOnce(roleRow({ rolePermissions: [{ permission: { id: 'p-rag', code: 'rag:query' } }] }));

    await service.updateRole('role-1', dto({ permissions: ['rag:query'] }), platformAdmin);

    expect(deleteMany).toHaveBeenCalledWith({ where: { roleId: 'role-1' } });
    expect(createMany).toHaveBeenCalledWith({ data: [{ roleId: 'role-1', permissionId: 'p-rag' }] });
  });

  it('replaces the permission set from permission ids', async () => {
    const { service, prisma, createMany } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow()).mockResolvedValueOnce(roleRow());

    await service.updateRole('role-1', dto({ permissionIds: ['p-chat', 'p-rag'] }), platformAdmin);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        { roleId: 'role-1', permissionId: 'p-chat' },
        { roleId: 'role-1', permissionId: 'p-rag' },
      ],
    });
  });

  it('clears the permission set with an empty array', async () => {
    const { service, prisma, deleteMany, createMany } = setup();
    prisma.role.findFirst
      .mockResolvedValueOnce(roleRow())
      .mockResolvedValueOnce(roleRow({ rolePermissions: [] }));

    const result = await service.updateRole('role-1', dto({ permissions: [] }), platformAdmin);

    expect(deleteMany).toHaveBeenCalledWith({ where: { roleId: 'role-1' } });
    expect(createMany).not.toHaveBeenCalled();
    expect(result.permissions).toEqual([]);
  });

  it('audits the permission diff', async () => {
    const { service, prisma, audit } = setup();
    prisma.role.findFirst
      .mockResolvedValueOnce(roleRow())
      .mockResolvedValueOnce(roleRow({ rolePermissions: [{ permission: { id: 'p-rag', code: 'rag:query' } }] }));

    await service.updateRole('role-1', dto({ permissions: ['rag:query'] }), platformAdmin);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'role_updated',
        entity: { type: 'role', id: 'role-1' },
        details: expect.objectContaining({
          role: 'TEACHING_ASSISTANT',
          previousName: 'TEACHING_ASSISTANT',
          previousScope: 'school',
          permissions: ['rag:query'],
          addedPermissions: ['rag:query'],
          removedPermissions: ['documents:read'],
        }),
      }),
      // The audit row is appended in the same transaction as the write (#45 review).
      expect.anything(),
    );
  });

  it('records the previous scope, so a scope-only edit is readable', async () => {
    const { service, prisma, audit } = setup();
    prisma.role.findFirst
      .mockResolvedValueOnce(roleRow())
      .mockResolvedValueOnce(roleRow({ scope: 'group' }));

    await service.updateRole('role-1', dto({ scope: 'group' }), platformAdmin);

    expect(audit.record.mock.calls[0][0]).toMatchObject({
      action: 'role_updated',
      details: { previousScope: 'school', scope: 'group' },
    });
  });

  it('answers 409, not 500, when a concurrent rename loses the unique index', async () => {
    const { service, prisma } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow()).mockResolvedValueOnce(roleRow());
    prisma.role.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }),
    );

    await expect(service.updateRole('role-1', dto({ name: 'another_name' }), platformAdmin)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('bumps the updated_at of the active assignments so the mobile sync sees the change', async () => {
    const { service, prisma, updateMany } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow()).mockResolvedValueOnce(roleRow());

    await service.updateRole('role-1', dto({ permissions: ['conversations:create'] }), platformAdmin);

    expect(updateMany).toHaveBeenCalledWith({
      where: { roleId: 'role-1', deletedAt: null },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('writes and audits nothing when the payload changes nothing', async () => {
    const { service, prisma, audit, update, deleteMany, updateMany } = setup();
    prisma.role.findFirst.mockResolvedValue(roleRow());

    const result = await service.updateRole(
      'role-1',
      dto({ name: 'teaching_assistant', permissions: ['documents:read'] }),
      platformAdmin,
    );

    expect(update).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(result.name).toBe('TEACHING_ASSISTANT');
  });

  it.each(['PLATFORM_ADMIN', 'SCHOOL_ADMIN', 'STUDENT'])('refuses to edit the base role %s', async (name) => {
    const { service, prisma } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow({ name }));

    await expect(service.updateRole('role-1', dto({ name: 'SOMETHING_ELSE' }), platformAdmin)).rejects.toThrow(
      'System base roles cannot be edited',
    );
  });

  it.each<[string, Partial<UpdateRoleDto>, string | null]>([
    ['no field at all', {}, 'Nothing to update: send name, scope, permissions or permissionIds'],
    [
      'both permission spellings',
      { permissions: ['rag:query'], permissionIds: ['p-rag'] },
      'Send either permissions (codes) or permissionIds (ids), not both',
    ],
    ['an unknown code', { permissions: ['documents:teleport'] }, 'Unknown permission code(s): documents:teleport'],
    ['an unknown id', { permissionIds: ['00000000-0000-4000-8000-000000000000'] }, null],
  ])('rejects %s with a 400', async (_label, overrides, message) => {
    const { service, prisma, audit, update } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow());

    const error = await service
      .updateRole('role-1', dto(overrides), platformAdmin)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    if (message) expect((error as BadRequestException).message).toBe(message);
    expect(update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects a name already used by another role with a 409', async () => {
    const { service, prisma, update } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow());
    prisma.role.findUnique.mockResolvedValueOnce({ id: 'other-role', name: 'TAKEN' });

    await expect(service.updateRole('role-1', dto({ name: 'taken' }), platformAdmin)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a name reserved for base roles', async () => {
    const { service, prisma } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow());

    await expect(service.updateRole('role-1', dto({ name: 'school_admin' }), platformAdmin)).rejects.toThrow(
      "Role name 'SCHOOL_ADMIN' is reserved for system base roles",
    );
  });

  it('refuses a school admin even when they reach the service', async () => {
    const { service, prisma, update } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow());

    await expect(
      service.updateRole('role-1', dto({ permissions: ['rag:query'] }), schoolAdmin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown role', async () => {
    const { service, prisma } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(null);

    await expect(service.updateRole('nope', dto({ name: 'new_name' }), platformAdmin)).rejects.toThrow(
      "Role 'nope' not found",
    );
  });

  it('checks the actor before the role, so a school-scoped admin gets 403 and not 404', async () => {
    const { service, prisma, update } = setup();

    await expect(service.updateRole('does-not-exist', dto({ name: 'x_role' }), schoolScopedAdmin)).rejects.toThrow(
      'Only platform administrators may edit roles',
    );
    expect(prisma.role.findFirst).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses system:manage on a non-platform role', async () => {
    const { service, prisma, update } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow({ scope: 'school' }));

    const error = await service
      .updateRole('role-1', dto({ permissions: ['system:manage'] }), platformAdmin)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe(
      'A role that grants system:manage must have the platform scope',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('accepts system:manage when the same PATCH makes the role platform-scoped', async () => {
    const { service, prisma, update } = setup();
    prisma.role.findFirst
      .mockResolvedValueOnce(roleRow({ scope: 'group' }))
      .mockResolvedValueOnce(roleRow({ scope: 'platform', rolePermissions: [{ permission: { id: 'p-manage', code: 'system:manage' } }] }));

    await service.updateRole('role-1', dto({ scope: 'platform', permissions: ['system:manage'] }), platformAdmin);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'role-1' },
      data: { name: 'TEACHING_ASSISTANT', scope: 'platform' },
    });
  });

  it('refuses to change the scope of a role that still has assignments', async () => {
    const { service, prisma, update } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(
      roleRow({ assignments: [{ userId: 'u-1' }, { userId: 'u-2' }, { userId: 'u-3' }] }),
    );

    const error = await service
      .updateRole('role-1', dto({ scope: 'platform' }), platformAdmin)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain('still assigned to 3 user(s)');
    expect(update).not.toHaveBeenCalled();
  });

  it('counts distinct users rather than assignment rows across schools when refusing a scope change', async () => {
    const { service, prisma } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(
      roleRow({ assignments: [{ userId: 'u-1' }, { userId: 'u-1' }] }),
    );

    const error = await service
      .updateRole('role-1', dto({ scope: 'platform' }), platformAdmin)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toContain('still assigned to 1 user(s)');
  });

  it('keeps the scope change allowed once the role has no assignments', async () => {
    const { service, prisma, update } = setup();
    prisma.role.findFirst
      .mockResolvedValueOnce(roleRow({ scope: 'school', assignments: [] }))
      .mockResolvedValueOnce(roleRow({ scope: 'group' }));

    await service.updateRole('role-1', dto({ scope: 'group' }), platformAdmin);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'role-1' },
      data: { name: 'TEACHING_ASSISTANT', scope: 'group' },
    });
  });

  describe('permission ids stay aligned with codes (#45 review)', () => {
    // `documents.access.manage` sorts before `documents:access.manage` under UTF-16 but after it under
    // `localeCompare`, which is how the two arrays used to drift apart.
    const dotted = [
      { id: 'id-colon', code: 'documents:access.manage' },
      { id: 'id-dot', code: 'documents.access.manage' },
      { id: 'id-update', code: 'documents:update' },
    ];

    it('maps both arrays from one list sorted by code, in findRoleById', async () => {
      const { service, prisma } = setup();
      prisma.role.findFirst.mockResolvedValueOnce(
        roleRow({ rolePermissions: dotted.map((permission) => ({ permission })) }),
      );

      const role = await service.findRoleById('role-1');

      const byCode = new Map(dotted.map((permission) => [permission.code, permission.id]));
      expect(role.permissions).toEqual([...role.permissions!].sort());
      role.permissions!.forEach((code, index) => {
        expect(role.permissionIds![index]).toBe(byCode.get(code));
      });
    });

    it('does the same for every row of findAllRoles', async () => {
      const { service, prisma } = setup();
      prisma.role.findMany = vi.fn().mockResolvedValue([
        roleRow({ rolePermissions: dotted.map((permission) => ({ permission })) }),
      ]);

      const [role] = await service.findAllRoles();

      const byCode = new Map(dotted.map((permission) => [permission.code, permission.id]));
      role.permissions!.forEach((code, index) => {
        expect(role.permissionIds![index]).toBe(byCode.get(code));
      });
    });
  });
});
