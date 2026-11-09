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
    userAssignment: { findFirst: vi.fn(), create: vi.fn() },
    groupMember: { upsert: vi.fn() },
  };
  const prisma = {
    user: { findUnique: vi.fn() },
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
