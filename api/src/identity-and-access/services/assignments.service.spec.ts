import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../audit/services/audit.service.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { AssignmentsService } from './assignments.service.js';

const actor = (scope: 'platform' | 'school', permissions = ['users:assign_role']) =>
  ({
    id: 'actor',
    role: scope === 'platform' ? 'PLATFORM_ADMIN' : 'SCHOOL_ADMIN',
    schoolId: 'school-a',
    permissions,
    assignments: [{ role: 'ADMIN', scope, schoolId: 'school-a', groupId: null, permissions }],
  }) as unknown as AuthenticatedUser;

const ROLES: Record<string, { id: string; name: string; scope: string }> = {
  PLATFORM_ADMIN: { id: 'r-platform', name: 'PLATFORM_ADMIN', scope: 'platform' },
  SCHOOL_ADMIN: { id: 'r-school-admin', name: 'SCHOOL_ADMIN', scope: 'school' },
  STAFF: { id: 'r-staff', name: 'STAFF', scope: 'school' },
  STUDENT: { id: 'r-student', name: 'STUDENT', scope: 'group' },
};

describe('AssignmentsService', () => {
  const tx = {
    $queryRaw: vi.fn(),
    userAssignment: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    groupMember: { upsert: vi.fn(), deleteMany: vi.fn() },
    role: { count: vi.fn() },
  };
  const prisma = {
    user: { findUnique: vi.fn() },
    userAssignment: { findFirst: vi.fn() },
    school: { findUnique: vi.fn() },
    role: { findUnique: vi.fn(), findMany: vi.fn() },
    group: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  const audit = { record: vi.fn() };
  const service = new AssignmentsService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  const dto = { userId: 'user-1', schoolId: 'school-a', role: 'STAFF' };

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'u@school.edu', assignments: [] });
    prisma.school.findUnique.mockImplementation(({ where }) =>
      Promise.resolve({ id: where.id, name: `School ${where.id}`, status: 'active' }),
    );
    prisma.role.findUnique.mockImplementation(({ where }) => Promise.resolve(ROLES[where.name] ?? null));
    prisma.role.findMany.mockResolvedValue(Object.values(ROLES));
    prisma.group.findUnique.mockResolvedValue({ id: 'group-1', name: 'ISI 4', schoolId: 'school-a' });
    prisma.$transaction.mockImplementation((fn) => fn(tx));
    tx.userAssignment.findFirst.mockResolvedValue(null);
    tx.userAssignment.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'assignment-1', createdAt: new Date(), ...data }),
    );
  });

  describe('createAssignment', () => {
    it('creates an assignment without a group and records role_assigned', async () => {
      const result = await service.createAssignment(dto, actor('school'));
      expect(result).toMatchObject({
        id: 'assignment-1',
        userId: 'user-1',
        schoolId: 'school-a',
        schoolName: 'School school-a',
        groupId: null,
        groupName: null,
        role: 'STAFF',
        roleScope: 'school',
      });
      expect(tx.userAssignment.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', schoolId: 'school-a', groupId: null, roleId: 'r-staff' },
      });
      expect(tx.groupMember.upsert).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role_assigned',
          details: expect.objectContaining({ schoolId: 'school-a', groupId: null, role: 'STAFF', previousRole: null }),
        }),
      );
    });

    it('with a group of the school, also adds the user to the group members', async () => {
      const result = await service.createAssignment({ ...dto, groupId: 'group-1', role: 'STUDENT' }, actor('school'));
      expect(result).toMatchObject({ groupId: 'group-1', groupName: 'ISI 4', role: 'STUDENT' });
      expect(tx.groupMember.upsert).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: 'group-1', userId: 'user-1' } },
        create: { groupId: 'group-1', userId: 'user-1' },
        update: {},
      });
    });

    it('rejects a group of another school', async () => {
      prisma.group.findUnique.mockResolvedValue({ id: 'group-1', name: 'X', schoolId: 'school-b' });
      await expect(service.createAssignment({ ...dto, groupId: 'group-1' }, actor('school'))).rejects.toThrow(
        new BadRequestException('The group does not belong to this school'),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an unknown group', async () => {
      prisma.group.findUnique.mockResolvedValue(null);
      await expect(service.createAssignment({ ...dto, groupId: 'nope' }, actor('school'))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects a group on a platform role', async () => {
      await expect(
        service.createAssignment({ ...dto, groupId: 'group-1', role: 'PLATFORM_ADMIN' }, actor('platform')),
      ).rejects.toThrow(new BadRequestException('A platform role cannot be limited to a group'));
    });

    it('rejects a role above the school admin level', async () => {
      await expect(service.createAssignment({ ...dto, role: 'PLATFORM_ADMIN' }, actor('school'))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lets a school admin grant a role at their own level', async () => {
      await expect(service.createAssignment({ ...dto, role: 'SCHOOL_ADMIN' }, actor('school'))).resolves.toMatchObject({
        role: 'SCHOOL_ADMIN',
      });
    });

    it('lets a platform admin assign a platform role in any school', async () => {
      await expect(
        service.createAssignment({ ...dto, schoolId: 'school-b', role: 'PLATFORM_ADMIN' }, actor('platform')),
      ).resolves.toMatchObject({ schoolId: 'school-b', role: 'PLATFORM_ADMIN' });
    });

    it('rejects another school before touching the database', async () => {
      await expect(service.createAssignment({ ...dto, schoolId: 'school-b' }, actor('school'))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a user who outranks the admin', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'boss@platform',
        assignments: [{ role: { scope: 'platform' } }],
      });
      await expect(service.createAssignment(dto, actor('school'))).rejects.toThrow(/higher-level role/);
    });

    it.each([
      ['an unknown user', () => prisma.user.findUnique.mockResolvedValue(null), NotFoundException],
      ['an unknown school', () => prisma.school.findUnique.mockResolvedValue(null), NotFoundException],
      [
        'a deactivated school',
        () => prisma.school.findUnique.mockResolvedValue({ id: 'school-a', name: 'A', status: 'deactivated' }),
        BadRequestException,
      ],
      ['an unknown role', () => prisma.role.findUnique.mockResolvedValue(null), BadRequestException],
    ])('rejects %s', async (_label, arrange, error) => {
      arrange();
      await expect(service.createAssignment(dto, actor('platform'))).rejects.toBeInstanceOf(error);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a second assignment in the same school (409) and records nothing', async () => {
      tx.userAssignment.findFirst.mockResolvedValue({ role: { name: 'STUDENT' } });
      await expect(service.createAssignment(dto, actor('school'))).rejects.toBeInstanceOf(ConflictException);
      expect(tx.userAssignment.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('locks the user row before checking for an existing assignment', async () => {
      await service.createAssignment(dto, actor('school'));
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.userAssignment.findFirst.mock.invocationCallOrder[0],
      );
    });

    it('ignores removed assignments (#49): for the 409 check and for the user level', async () => {
      await service.createAssignment(dto, actor('school'));
      expect(tx.userAssignment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', schoolId: 'school-a', deletedAt: null } }),
      );
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ assignments: expect.objectContaining({ where: { deletedAt: null } }) }),
        }),
      );
    });
  });

  describe('updateAssignment', () => {
    const before = new Date('2026-11-01T00:00:00.000Z');
    const after = new Date('2026-11-09T00:00:00.000Z');
    /** Assignment of user-1 in school-a: STUDENT in group-1 by default. */
    const existing = (over: { role?: string; groupId?: string | null; userScopes?: string[]; status?: string } = {}) => {
      const role = ROLES[over.role ?? 'STUDENT'];
      const groupId = over.groupId === undefined ? 'group-1' : over.groupId;
      return {
        id: 'assignment-1',
        groupId,
        createdAt: before,
        updatedAt: before,
        user: {
          id: 'user-1',
          email: 'U@school.edu',
          assignments: (over.userScopes ?? [role.scope]).map((scope) => ({ role: { scope } })),
        },
        school: { id: 'school-a', name: 'School A', status: over.status ?? 'active' },
        role,
        group: groupId ? { id: groupId, name: 'ISI 4' } : null,
      };
    };
    const arrange = (row: ReturnType<typeof existing>) => {
      prisma.userAssignment.findFirst.mockResolvedValue(row);
      tx.userAssignment.findFirst.mockResolvedValue({
        groupId: row.groupId,
        updatedAt: row.updatedAt,
        role: { id: row.role.id, name: row.role.name },
      });
    };

    beforeEach(() => {
      arrange(existing());
      tx.userAssignment.update.mockResolvedValue({ updatedAt: after });
      prisma.group.findUnique.mockImplementation(({ where }) =>
        Promise.resolve({ id: where.id, name: `Group ${where.id}`, schoolId: 'school-a' }),
      );
    });

    it('changes the role, moves updatedAt and records assignment_updated', async () => {
      const result = await service.updateAssignment('assignment-1', { role: 'STAFF' }, actor('school'));
      expect(result).toMatchObject({ role: 'STAFF', roleScope: 'school', groupId: 'group-1', updatedAt: after });
      expect(tx.userAssignment.update).toHaveBeenCalledWith({
        where: { id: 'assignment-1' },
        data: { roleId: 'r-staff', groupId: 'group-1' },
        select: { updatedAt: true },
      });
      expect(tx.groupMember.deleteMany).not.toHaveBeenCalled();
      expect(tx.groupMember.upsert).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'assignment_updated',
          details: expect.objectContaining({
            assignmentId: 'assignment-1',
            email: 'u@school.edu',
            role: 'STAFF',
            previousRole: 'STUDENT',
            groupId: 'group-1',
            previousGroupId: 'group-1',
          }),
        }),
      );
    });

    it('moves the user from the old group members to the new group', async () => {
      const result = await service.updateAssignment('assignment-1', { groupId: 'group-2' }, actor('school'));
      expect(result).toMatchObject({ groupId: 'group-2', groupName: 'Group group-2', role: 'STUDENT' });
      expect(tx.groupMember.deleteMany).toHaveBeenCalledWith({ where: { groupId: 'group-1', userId: 'user-1' } });
      expect(tx.groupMember.upsert).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: 'group-2', userId: 'user-1' } },
        create: { groupId: 'group-2', userId: 'user-1' },
        update: {},
      });
    });

    it('groupId: null removes the group and the old membership only', async () => {
      const result = await service.updateAssignment('assignment-1', { groupId: null }, actor('school'));
      expect(result).toMatchObject({ groupId: null, groupName: null });
      expect(tx.userAssignment.update).toHaveBeenCalledWith(expect.objectContaining({ data: { roleId: 'r-student', groupId: null } }));
      expect(tx.groupMember.deleteMany).toHaveBeenCalledWith({ where: { groupId: 'group-1', userId: 'user-1' } });
      expect(tx.groupMember.upsert).not.toHaveBeenCalled();
    });

    it('adds a group to an assignment that had none', async () => {
      arrange(existing({ role: 'STAFF', groupId: null }));
      await service.updateAssignment('assignment-1', { groupId: 'group-2' }, actor('school'));
      expect(tx.groupMember.deleteMany).not.toHaveBeenCalled();
      expect(tx.groupMember.upsert).toHaveBeenCalled();
    });

    it.each([
      ['the same role', { role: 'STUDENT' }],
      ['the same group', { groupId: 'group-1' }],
      ['the same role and group', { role: 'STUDENT', groupId: 'group-1' }],
    ])('writes nothing for %s and keeps updatedAt', async (_label, dto) => {
      const result = await service.updateAssignment('assignment-1', dto, actor('school'));
      expect(result).toMatchObject({ role: 'STUDENT', groupId: 'group-1', updatedAt: before });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('writes nothing when a concurrent request already made the change', async () => {
      tx.userAssignment.findFirst.mockResolvedValue({ groupId: 'group-1', updatedAt: after, role: { id: 'r-staff', name: 'STAFF' } });
      const result = await service.updateAssignment('assignment-1', { role: 'STAFF' }, actor('school'));
      expect(result.updatedAt).toEqual(after);
      expect(tx.userAssignment.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('takes the old group from the locked re-read, after the user row is locked', async () => {
      tx.userAssignment.findFirst.mockResolvedValue({ groupId: 'group-9', updatedAt: before, role: { id: 'r-student', name: 'STUDENT' } });
      await service.updateAssignment('assignment-1', { groupId: 'group-2' }, actor('school'));
      expect(tx.groupMember.deleteMany).toHaveBeenCalledWith({ where: { groupId: 'group-9', userId: 'user-1' } });
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.userAssignment.findFirst.mock.invocationCallOrder[0]);
    });

    it('rejects an empty body', async () => {
      await expect(service.updateAssignment('assignment-1', {}, actor('school'))).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.userAssignment.findFirst).not.toHaveBeenCalled();
    });

    it('rejects an unknown assignment (404)', async () => {
      prisma.userAssignment.findFirst.mockResolvedValue(null);
      await expect(service.updateAssignment('nope', { role: 'STAFF' }, actor('platform'))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects an assignment of another school (403)', async () => {
      arrange({ ...existing(), school: { id: 'school-b', name: 'B', status: 'active' } });
      await expect(service.updateAssignment('assignment-1', { role: 'STAFF' }, actor('school'))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a deactivated school (400)', async () => {
      arrange(existing({ status: 'deactivated' }));
      await expect(service.updateAssignment('assignment-1', { role: 'STAFF' }, actor('platform'))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a role above the school admin level (403)', async () => {
      await expect(
        service.updateAssignment('assignment-1', { role: 'PLATFORM_ADMIN', groupId: null }, actor('school')),
      ).rejects.toThrow('Only a platform administrator can assign the PLATFORM_ADMIN role');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects editing a user who outranks the admin (403), even for a group-only change', async () => {
      arrange(existing({ userScopes: ['group', 'platform'] }));
      await expect(service.updateAssignment('assignment-1', { groupId: null }, actor('school'))).rejects.toThrow(
        /higher-level role/,
      );
    });

    it('rejects an unknown role (400)', async () => {
      await expect(service.updateAssignment('assignment-1', { role: 'NOPE' }, actor('platform'))).rejects.toThrow(
        new BadRequestException("Unknown role 'NOPE'"),
      );
    });

    it('rejects a group of another school (400) and an unknown group (404)', async () => {
      prisma.group.findUnique.mockResolvedValueOnce({ id: 'group-b', name: 'B1', schoolId: 'school-b' });
      await expect(service.updateAssignment('assignment-1', { groupId: 'group-b' }, actor('platform'))).rejects.toThrow(
        new BadRequestException('The group does not belong to this school'),
      );
      prisma.group.findUnique.mockResolvedValueOnce(null);
      await expect(service.updateAssignment('assignment-1', { groupId: 'nope' }, actor('platform'))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a platform role that would keep the current group (400), unless the group is cleared', async () => {
      await expect(service.updateAssignment('assignment-1', { role: 'PLATFORM_ADMIN' }, actor('platform'))).rejects.toThrow(
        new BadRequestException('A platform role cannot be limited to a group'),
      );
      await expect(
        service.updateAssignment('assignment-1', { role: 'PLATFORM_ADMIN', groupId: null }, actor('platform')),
      ).resolves.toMatchObject({ role: 'PLATFORM_ADMIN', groupId: null });
    });

    it('only finds active assignments: a removed one is 404 (#49)', async () => {
      await service.updateAssignment('assignment-1', { role: 'STAFF' }, actor('school'));
      expect(prisma.userAssignment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'assignment-1', deletedAt: null } }),
      );
      expect(tx.userAssignment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'assignment-1', deletedAt: null } }),
      );
    });
  });

  describe('removeAssignment', () => {
    /** Active assignment of user-1 in school-a: STAFF in group-1 by default. */
    const existing = (over: { role?: string; userScopes?: string[]; status?: string; schoolId?: string } = {}) => {
      const role = ROLES[over.role ?? 'STAFF'];
      return {
        id: 'assignment-1',
        user: {
          id: 'user-1',
          email: 'U@school.edu',
          assignments: (over.userScopes ?? [role.scope]).map((scope) => ({ role: { scope } })),
        },
        school: { id: over.schoolId ?? 'school-a', status: over.status ?? 'active' },
        role: { name: role.name, scope: role.scope },
      };
    };
    /** Arranges the row read before and under the locks; `otherAdmins` = other non-suspended school admins. */
    const arrange = (
      row: ReturnType<typeof existing>,
      locked: { userStatus?: string; isAdminRole?: boolean; otherAdmins?: number; stillInSchool?: number } = {},
    ) => {
      prisma.userAssignment.findFirst.mockResolvedValue(row);
      tx.userAssignment.findFirst.mockResolvedValue({
        roleId: ROLES[row.role.name].id,
        groupId: 'group-1',
        role: { name: row.role.name },
        user: { status: locked.userStatus ?? 'ACTIVE' },
      });
      tx.role.count.mockResolvedValue(locked.isAdminRole ? 1 : 0);
      tx.userAssignment.count.mockImplementation(({ where }) =>
        Promise.resolve(where.role ? (locked.otherAdmins ?? 0) : (locked.stillInSchool ?? 0)),
      );
    };

    beforeEach(() => arrange(existing()));

    it('sets deletedAt, removes the school group memberships and records assignment_removed', async () => {
      await expect(service.removeAssignment('assignment-1', actor('school'))).resolves.toBeUndefined();
      expect(tx.userAssignment.update).toHaveBeenCalledWith({
        where: { id: 'assignment-1' },
        data: { deletedAt: expect.any(Date), updatedAt: expect.any(Date) },
      });
      const { data } = tx.userAssignment.update.mock.calls[0][0];
      expect(data.updatedAt).toBe(data.deletedAt);
      expect(tx.groupMember.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', group: { schoolId: 'school-a' } },
      });
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'assignment_removed',
          actor: expect.objectContaining({ userId: 'actor' }),
          entity: { type: 'user', id: 'user-1' },
          details: {
            assignmentId: 'assignment-1',
            email: 'u@school.edu',
            schoolId: 'school-a',
            role: 'STAFF',
            groupId: 'group-1',
          },
        }),
      );
    });

    it('locks the school row, then the user row, before re-reading the assignment', async () => {
      await service.removeAssignment('assignment-1', actor('school'));
      const [school, user] = tx.$queryRaw.mock.calls.map((call) => (call[0] as string[]).join('?'));
      expect(school).toContain('FROM schools');
      expect(user).toContain('FROM users');
      expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.userAssignment.findFirst.mock.invocationCallOrder[0]);
      expect(tx.userAssignment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'assignment-1', deletedAt: null } }),
      );
    });

    it('keeps the group memberships if another active assignment remains in the school', async () => {
      arrange(existing(), { stillInSchool: 1 });
      await service.removeAssignment('assignment-1', actor('school'));
      expect(tx.groupMember.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects an unknown or already removed assignment (404) and records nothing', async () => {
      prisma.userAssignment.findFirst.mockResolvedValue(null);
      await expect(service.removeAssignment('assignment-1', actor('platform'))).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.userAssignment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'assignment-1', deletedAt: null } }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('rejects an assignment removed by a concurrent request (404 from the locked re-read)', async () => {
      tx.userAssignment.findFirst.mockResolvedValue(null);
      await expect(service.removeAssignment('assignment-1', actor('platform'))).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.userAssignment.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it.each([
      ['another school', existing({ schoolId: 'school-b' })],
      ['a role above the school admin level', existing({ role: 'PLATFORM_ADMIN' })],
      ['a user who outranks the admin', existing({ userScopes: ['school', 'platform'] })],
    ])('rejects %s (403) before writing', async (_label, row) => {
      arrange(row);
      await expect(service.removeAssignment('assignment-1', actor('school'))).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a deactivated school (400)', async () => {
      arrange(existing({ status: 'deactivated' }));
      await expect(service.removeAssignment('assignment-1', actor('platform'))).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects the last school admin of the school (409) and writes nothing', async () => {
      arrange(existing({ role: 'SCHOOL_ADMIN' }), { isAdminRole: true, otherAdmins: 0 });
      await expect(service.removeAssignment('assignment-1', actor('platform'))).rejects.toBeInstanceOf(ConflictException);
      expect(tx.userAssignment.count).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          schoolId: 'school-a',
          id: { not: 'assignment-1' },
          role: { scope: 'school', rolePermissions: { some: { permission: { code: 'users:assign_role' } } } },
          user: { status: { not: 'SUSPENDED' } },
        },
      });
      expect(tx.userAssignment.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('removes a school admin when another non-suspended admin remains', async () => {
      arrange(existing({ role: 'SCHOOL_ADMIN' }), { isAdminRole: true, otherAdmins: 1 });
      await service.removeAssignment('assignment-1', actor('school'));
      expect(tx.userAssignment.update).toHaveBeenCalled();
    });

    it('removes a suspended last admin: the school does not lose a working admin', async () => {
      arrange(existing({ role: 'SCHOOL_ADMIN' }), { isAdminRole: true, otherAdmins: 0, userStatus: 'SUSPENDED' });
      await service.removeAssignment('assignment-1', actor('platform'));
      expect(tx.role.count).not.toHaveBeenCalled();
      expect(tx.userAssignment.update).toHaveBeenCalled();
    });

    it('does not count admins for a non-admin role', async () => {
      await service.removeAssignment('assignment-1', actor('school'));
      expect(tx.role.count).toHaveBeenCalledWith({
        where: {
          id: 'r-staff',
          scope: 'school',
          rolePermissions: { some: { permission: { code: 'users:assign_role' } } },
        },
      });
      expect(tx.userAssignment.count).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ role: expect.anything() }) }),
      );
    });
  });

  describe('listAssignableRoles', () => {
    it('gives a platform admin every role, highest level first', async () => {
      const roles = await service.listAssignableRoles(actor('platform'));
      expect(roles.map((r) => [r.name, r.level])).toEqual([
        ['PLATFORM_ADMIN', 3],
        ['SCHOOL_ADMIN', 2],
        ['STAFF', 2],
        ['STUDENT', 1],
      ]);
    });

    it('gives a school admin only school and group roles', async () => {
      const roles = await service.listAssignableRoles(actor('school'));
      expect(roles.map((r) => r.name)).toEqual(['SCHOOL_ADMIN', 'STAFF', 'STUDENT']);
    });

    it('rejects a school outside the admin scope', async () => {
      await expect(service.listAssignableRoles(actor('school'), 'school-b')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('gives nothing without users:assign_role', async () => {
      expect(await service.listAssignableRoles(actor('school', ['users:read']))).toEqual([]);
    });
  });
});
