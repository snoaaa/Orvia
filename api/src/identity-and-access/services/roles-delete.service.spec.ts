import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser, AuthRoleAssignment } from '../../auth/types/authenticated-user.js';
import { IdentityAndAccessService } from './identity-and-access.service.js';

/**
 * DELETE /roles/:id (#46): removing an unused custom role.
 *
 * What matters is what must *not* happen: base roles are never deleted, a role people still hold is
 * refused with an explicit count, and an actor without platform-wide `system:manage` cannot even learn
 * whether the role exists. A successful delete also has to reach the audit trail.
 */
describe('IdentityAndAccessService - delete role (#46)', () => {
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
  /** A school-scoped role that (wrongly) holds platform administration, built straight in the database. */
  const schoolScopedSysManager = actorWith({
    role: 'SCHOOL_SYS_MANAGER',
    scope: 'school',
    schoolId: 'school-1',
    groupId: null,
    permissions: ['system:manage'],
  });

  const roleRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'role-1',
    name: 'TEACHING_ASSISTANT',
    scope: 'school',
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    updatedAt: new Date('2026-11-01T10:00:00.000Z'),
    ...overrides,
  });

  function setup() {
    const remove = vi.fn().mockResolvedValue({});
    const assignedUsers = vi.fn().mockResolvedValue(0);
    const accessRules = vi.fn().mockResolvedValue(0);

    const prisma = {
      role: { findFirst: vi.fn(), delete: remove },
      userAssignment: { count: assignedUsers },
      documentAccess: { count: accessRules },
    };

    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new IdentityAndAccessService(
      prisma as never,
      audit as never,
      {} as never,
      {} as never,
    );

    return { service, prisma, audit, remove, assignedUsers, accessRules };
  }

  it('deletes an unassigned custom role and audits it', async () => {
    const { service, prisma, audit, remove, assignedUsers, accessRules } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow());
    assignedUsers.mockResolvedValueOnce(0);
    accessRules.mockResolvedValueOnce(2);

    const result = await service.deleteRole('role-1', platformAdmin);

    expect(remove).toHaveBeenCalledWith({ where: { id: 'role-1' } });
    expect(result).toEqual({ success: true, message: "Role 'TEACHING_ASSISTANT' was successfully deleted" });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'role_deleted',
        entity: { type: 'role', id: 'role-1' },
        details: { role: 'TEACHING_ASSISTANT', scope: 'school', documentAccessRulesRemoved: 2 },
      }),
    );
  });

  it('finds the role by name, ignoring case', async () => {
    const { service, prisma, remove } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow());

    await service.deleteRole('teaching_assistant', platformAdmin);

    expect(prisma.role.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: 'teaching_assistant' }, { name: 'TEACHING_ASSISTANT' }] },
    });
    expect(remove).toHaveBeenCalledWith({ where: { id: 'role-1' } });
  });

  it.each(['PLATFORM_ADMIN', 'SCHOOL_ADMIN', 'CONTENT_MANAGER', 'STAFF', 'STUDENT', 'PARENT_GUEST'])(
    'refuses to delete the base role %s',
    async (name) => {
      const { service, prisma, remove, audit } = setup();
      prisma.role.findFirst.mockResolvedValueOnce(roleRow({ name }));

      const error = await service.deleteRole('role-1', platformAdmin).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe('System base roles cannot be deleted');
      expect(remove).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('refuses a role that is still assigned and names the user count', async () => {
    const { service, prisma, remove, assignedUsers, audit } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow());
    assignedUsers.mockResolvedValueOnce(3);

    const error = await service.deleteRole('role-1', platformAdmin).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe(
      "Cannot delete role 'TEACHING_ASSISTANT': still assigned to 3 user(s). Please reassign them before deleting.",
    );
    expect(remove).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('only counts active assignments, so a removed assignment does not block the delete', async () => {
    const { service, prisma, remove, assignedUsers } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow());
    assignedUsers.mockResolvedValueOnce(0);

    await service.deleteRole('role-1', platformAdmin);

    expect(assignedUsers).toHaveBeenCalledWith({ where: { roleId: 'role-1', deletedAt: null } });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('answers 404 for an unknown role', async () => {
    const { service, prisma, remove } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(null);

    await expect(service.deleteRole('nope', platformAdmin)).rejects.toBeInstanceOf(NotFoundException);
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    ['a school admin', () => schoolAdmin],
    ['a school-scoped system:manage holder', () => schoolScopedSysManager],
  ])('refuses %s before looking the role up', async (_label, actor) => {
    const { service, prisma, remove } = setup();

    await expect(service.deleteRole('role-1', actor())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.deleteRole('role-1', actor())).rejects.toThrow(
      'Only platform administrators may delete roles',
    );
    expect(prisma.role.findFirst).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
