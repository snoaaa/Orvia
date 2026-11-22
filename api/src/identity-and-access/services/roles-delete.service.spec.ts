import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { IdentityAndAccessService } from './identity-and-access.service.js';

/**
 * DELETE /roles/:id (#46).
 *
 * The whole operation — lookup, assignment check, cascade counts, delete and audit — runs inside one
 * transaction under a lock on the role row, so two concurrent deletes cannot both answer 200 with
 * duplicate audit rows and a failed audit append rolls the deletion back.
 */
describe('IdentityAndAccessService - delete role (#46)', () => {
  const actor = (scope: 'platform' | 'school', permissions = ['system:manage']) =>
    ({
      id: 'actor',
      email: 'actor@platform.edu',
      fullName: 'Actor',
      status: 'ACTIVE',
      isPlatformAdmin: scope === 'platform',
      permissions,
      schoolIds: ['school-1'],
      assignments: [
        {
          role: scope === 'platform' ? 'PLATFORM_ADMIN' : 'SCHOOL_ADMIN',
          scope,
          schoolId: 'school-1',
          schoolStatus: 'active',
          groupId: null,
          permissions,
        },
      ],
      role: scope === 'platform' ? 'PLATFORM_ADMIN' : 'SCHOOL_ADMIN',
      schoolId: 'school-1',
      sessionId: null,
    }) as AuthenticatedUser;
  const platformAdmin = actor('platform');
  const schoolAdmin = actor('school', ['users:assign_role']);
  const schoolScopedSysManager = actor('school');

  const roleRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'role-1',
    name: 'TEACHING_ASSISTANT',
    scope: 'school',
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    updatedAt: new Date('2026-11-01T10:00:00.000Z'),
    ...overrides,
  });

  function setup() {
    const removeMany = vi.fn().mockResolvedValue({ count: 1 });
    const holders = vi.fn().mockResolvedValue([]);
    const assignmentRecords = vi.fn().mockResolvedValue(0);
    const accessRules = vi.fn().mockResolvedValue(0);

    const prisma = {
      // The lock statement that resolves the role row, `SELECT id FROM roles WHERE ... FOR UPDATE`.
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'role-1' }]),
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
      role: { findFirst: vi.fn(), deleteMany: removeMany },
      userAssignment: { findMany: holders, count: assignmentRecords },
      documentAccess: { count: accessRules },
    };

    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new IdentityAndAccessService(
      prisma as unknown as PrismaService,
      audit as never,
      {} as never,
      {} as never,
    );

    return { service, prisma, audit, removeMany, holders, assignmentRecords, accessRules };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('locks the role row, deletes it in that transaction and audits it there', async () => {
    const { service, prisma, audit, removeMany, accessRules } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow());
    accessRules.mockResolvedValueOnce(2);

    const result = await service.deleteRole('role-1', platformAdmin);

    // The lock is the first statement of the transaction, before anything is read.
    const sql = (prisma.$queryRaw.mock.calls[0][0] as string[]).join('?');
    expect(sql).toContain('FROM roles');
    expect(sql).toContain('FOR UPDATE');
    // Deleted through deleteMany so a lost race is a count of 0, not a P2025 crash.
    expect(removeMany).toHaveBeenCalledWith({ where: { id: 'role-1' } });
    expect(result).toEqual({ success: true, message: "Role 'TEACHING_ASSISTANT' was successfully deleted" });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'role_deleted',
        entity: { type: 'role', id: 'role-1' },
        details: {
          role: 'TEACHING_ASSISTANT',
          scope: 'school',
          documentAccessRulesRemoved: 2,
          assignmentRecordsRemoved: 0,
        },
      }),
      // Same transaction as the delete: a failed append rolls the deletion back.
      expect.anything(),
    );
  });

  it('finds the role by name as well, ignoring case', async () => {
    const { service, prisma, removeMany } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow());

    await service.deleteRole('teaching_assistant', platformAdmin);

    const sql = (prisma.$queryRaw.mock.calls[0][0] as string[]).join('?');
    expect(sql).toContain('OR name =');
    expect(removeMany).toHaveBeenCalledWith({ where: { id: 'role-1' } });
  });

  it.each(['PLATFORM_ADMIN', 'SCHOOL_ADMIN', 'CONTENT_MANAGER', 'STAFF', 'STUDENT', 'PARENT_GUEST'])(
    'refuses to delete the base role %s',
    async (name) => {
      const { service, prisma, removeMany, audit } = setup();
      prisma.role.findFirst.mockResolvedValueOnce(roleRow({ name }));

      const error = await service.deleteRole('role-1', platformAdmin).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe('System base roles cannot be deleted');
      expect(removeMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('refuses a role that is still assigned and names how many users hold it', async () => {
    const { service, prisma, removeMany, holders, audit } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow());
    holders.mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]);

    const error = await service.deleteRole('role-1', platformAdmin).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe(
      "Cannot delete role 'TEACHING_ASSISTANT': still assigned to 3 user(s). Please reassign them before deleting.",
    );
    expect(removeMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('counts distinct users, so the same person in two schools is one user', async () => {
    const { service, prisma, holders } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow());
    // The database already collapses the two rows of the same user thanks to `distinct`.
    holders.mockResolvedValueOnce([{ userId: 'u1' }]);

    const error = await service.deleteRole('role-1', platformAdmin).catch((caught: unknown) => caught);

    expect((error as BadRequestException).message).toContain('still assigned to 1 user(s)');
    expect(holders).toHaveBeenCalledWith({
      where: { roleId: 'role-1', deletedAt: null },
      select: { userId: true },
      distinct: ['userId'],
    });
  });

  it('only counts active assignments, so a removed assignment does not block the delete', async () => {
    const { service, prisma, removeMany, holders, assignmentRecords } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow());
    // One soft-deleted tombstone (#49) is about to cascade away, which the audit records.
    assignmentRecords.mockResolvedValueOnce(1);

    await service.deleteRole('role-1', platformAdmin);

    expect(holders).toHaveBeenCalledWith(expect.objectContaining({ where: { roleId: 'role-1', deletedAt: null } }));
    expect(removeMany).toHaveBeenCalledTimes(1);
  });

  it('reports the assignment records the cascade removes (soft-deleted tombstones, #49)', async () => {
    const { service, prisma, audit, assignmentRecords } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow());
    assignmentRecords.mockResolvedValueOnce(2);

    await service.deleteRole('role-1', platformAdmin);

    expect(audit.record.mock.calls[0][0]).toMatchObject({
      details: expect.objectContaining({ assignmentRecordsRemoved: 2 }),
    });
  });

  it('answers 404 for an unknown role', async () => {
    const { service, prisma, removeMany } = setup();
    prisma.$queryRaw.mockResolvedValueOnce([]);

    await expect(service.deleteRole('nope', platformAdmin)).rejects.toBeInstanceOf(NotFoundException);
    expect(removeMany).not.toHaveBeenCalled();
  });

  it('answers 404 when another delete won the race between the lock and the delete', async () => {
    const { service, prisma, removeMany, audit } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow());
    removeMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.deleteRole('role-1', platformAdmin)).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rolls the deletion back when the audit append fails', async () => {
    const { service, prisma, audit, removeMany } = setup();
    prisma.role.findFirst.mockResolvedValueOnce(roleRow());
    audit.record.mockRejectedValueOnce(new Error('audit chain unavailable'));

    await expect(service.deleteRole('role-1', platformAdmin)).rejects.toThrow('audit chain unavailable');
    // Same transaction: Prisma would roll the delete back, so the row is still there afterwards.
    expect(removeMany).toHaveBeenCalledTimes(1);
    expect((prisma.$transaction as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(1);
  });

  it.each([
    ['a school admin', () => schoolAdmin],
    ['a school-scoped system:manage holder', () => schoolScopedSysManager],
  ])('refuses %s before looking the role up', async (_label, actorOf) => {
    const { service, prisma, removeMany } = setup();

    await expect(service.deleteRole('role-1', actorOf())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.deleteRole('role-1', actorOf())).rejects.toThrow(
      'Only platform administrators may delete roles',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(removeMany).not.toHaveBeenCalled();
  });
});
