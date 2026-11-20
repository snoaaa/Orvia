import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser, AuthRoleAssignment } from '../../auth/types/authenticated-user.js';
import type { CreateRoleDto } from '../dto/index.js';
import { IdentityAndAccessService } from './identity-and-access.service.js';

/** POST /roles (#44): createRole(). */
describe('IdentityAndAccessService - create role', () => {
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
  const catalogue = [
    { id: 'p-read', code: 'documents:read' },
    { id: 'p-chat', code: 'conversations:create' },
  ];
  const dto = (overrides: Partial<CreateRoleDto> = {}): CreateRoleDto => ({
    name: 'teaching_assistant',
    scope: 'school',
    permissions: ['documents:read', 'conversations:create'],
    ...overrides,
  });

  /** A Prisma double: `create` decides what the transaction does (resolve, or throw a P2002 for a duplicate). */
  function setup(create = vi.fn().mockResolvedValue({ id: 'role-1' })) {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const now = new Date('2026-11-09T12:00:00.000Z');
    const prisma = {
      permission: {
        findMany: vi.fn(async ({ where }: { where: { code: { in: string[] } } }) =>
          catalogue.filter((p) => where.code.in.includes(p.code)),
        ),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ role: { create }, rolePermission: { createMany } }),
      ),
      role: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'role-1',
          name: 'TEACHING_ASSISTANT',
          scope: 'school',
          createdAt: now,
          updatedAt: now,
          rolePermissions: catalogue.map((p) => ({ permission: { code: p.code } })),
          _count: { assignments: 0 },
        }),
      },
    };
    const service = new IdentityAndAccessService(prisma as never, {} as never, {} as never, {} as never);
    return { service, prisma, create, createMany };
  }

  it('creates the role in upper case with its scope and permissions, in one transaction', async () => {
    const { service, prisma, create, createMany } = setup();

    const role = await service.createRole(dto(), platformAdmin);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: { id: expect.any(String), name: 'TEACHING_ASSISTANT', scope: 'school' },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { roleId: 'role-1', permissionId: 'p-read' },
        { roleId: 'role-1', permissionId: 'p-chat' },
      ],
    });
    expect(role).toMatchObject({
      id: 'role-1',
      name: 'TEACHING_ASSISTANT',
      scope: 'school',
      permissions: ['conversations:create', 'documents:read'],
      assignedUsersCount: 0,
      isBase: false,
    });
  });

  it('refuses a school-scoped role, even one holding system:manage', async () => {
    const { service, prisma } = setup();
    const schoolRole = actorWith({ role: 'CUSTOM', scope: 'school', schoolId: 'A', groupId: null, permissions: ['system:manage'] });

    await expect(service.createRole(dto(), schoolRole)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['PLATFORM_ADMIN', 'student', ' School_Admin '])('rejects the base role name %j', async (name) => {
    const { service, prisma } = setup();
    await expect(service.createRole(dto({ name }), platformAdmin)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects unknown permission codes, names them, and creates nothing', async () => {
    const { service, prisma } = setup();
    const promise = service.createRole(dto({ permissions: ['documents:read', 'documents:fly', 'nope'] }), platformAdmin);

    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(promise).rejects.toThrow('Unknown permission code(s): documents:fly, nope');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('turns a duplicate name (unique index, P2002) into 409', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const { service } = setup(vi.fn().mockRejectedValue(duplicate));

    await expect(service.createRole(dto(), platformAdmin)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not hide other database errors', async () => {
    const { service } = setup(vi.fn().mockRejectedValue(new Error('connection lost')));
    await expect(service.createRole(dto(), platformAdmin)).rejects.toThrow('connection lost');
  });
});
