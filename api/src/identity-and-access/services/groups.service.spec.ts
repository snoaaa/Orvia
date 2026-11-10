import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { GroupsService } from './groups.service.js';

const actor = (scope: 'platform' | 'school', permissions = ['groups:create']) =>
  ({
    id: 'actor',
    isPlatformAdmin: scope === 'platform',
    permissions,
    schoolIds: ['school-a'],
    assignments: [{ role: 'ADMIN', scope, schoolId: 'school-a', schoolStatus: 'active', groupId: null, permissions }],
  }) as unknown as AuthenticatedUser;

describe('GroupsService', () => {
  const prisma = {
    school: { findUnique: vi.fn() },
    group: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  };
  const service = new GroupsService(prisma as unknown as PrismaService);
  const dto = { schoolId: 'school-a', name: 'Class 4-A' };

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.school.findUnique.mockResolvedValue({ status: 'active' });
    prisma.group.create.mockImplementation(({ data }) => Promise.resolve({ id: 'group-1', ...data }));
    prisma.group.findUnique.mockResolvedValue({ id: 'group-1', schoolId: 'school-a', name: 'Class 4-A', type: 'class', createdAt: new Date(), updatedAt: new Date() });
    prisma.group.findMany.mockResolvedValue([
      { id: 'group-1', schoolId: 'school-a', name: 'Class 4-A', type: 'class', createdAt: new Date(), updatedAt: new Date() },
    ]);
  });

  it('creates a group in the admin school, of type class by default', async () => {
    const group = await service.createGroup(dto, actor('school'));
    expect(group).toMatchObject({ id: 'group-1', schoolId: 'school-a', name: 'Class 4-A', type: 'class' });
  });

  it('keeps the requested type', async () => {
    const group = await service.createGroup({ ...dto, type: 'team' }, actor('school'));
    expect(group.type).toBe('team');
  });

  it('lets a platform admin create a group in any school', async () => {
    const group = await service.createGroup({ ...dto, schoolId: 'school-b' }, actor('platform'));
    expect(group.schoolId).toBe('school-b');
  });

  it('rejects another school before touching the database', async () => {
    await expect(service.createGroup({ ...dto, schoolId: 'school-b' }, actor('school'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.school.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unknown school', async () => {
    prisma.school.findUnique.mockResolvedValue(null);
    await expect(service.createGroup(dto, actor('platform'))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a deactivated school', async () => {
    prisma.school.findUnique.mockResolvedValue({ status: 'deactivated' });
    await expect(service.createGroup(dto, actor('platform'))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.group.create).not.toHaveBeenCalled();
  });

  it('turns a unique constraint violation into a 409', async () => {
    prisma.group.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }),
    );
    await expect(service.createGroup(dto, actor('school'))).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not hide other database errors', async () => {
    const failure = new Error('connection lost');
    prisma.group.create.mockRejectedValue(failure);
    await expect(service.createGroup(dto, actor('school'))).rejects.toBe(failure);
  });

  describe('findGroupById (#89)', () => {
    it('returns group when school admin has access to group school', async () => {
      const group = await service.findGroupById('group-1', actor('school', ['groups:read']));
      expect(group.id).toBe('group-1');
      expect(group.schoolId).toBe('school-a');
    });

    it('returns group when platform admin requests group in any school', async () => {
      prisma.group.findUnique.mockResolvedValueOnce({
        id: 'group-2',
        schoolId: 'school-b',
        name: 'Class 4-B',
        type: 'class',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const group = await service.findGroupById('group-2', actor('platform', ['groups:read']));
      expect(group.id).toBe('group-2');
      expect(group.schoolId).toBe('school-b');
    });

    it('throws 403 Forbidden when school admin attempts to access group belonging to another school', async () => {
      prisma.group.findUnique.mockResolvedValueOnce({
        id: 'group-foreign',
        schoolId: 'school-other',
        name: 'Secret Group',
        type: 'team',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await expect(service.findGroupById('group-foreign', actor('school', ['groups:read']))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws 404 NotFoundException when group does not exist', async () => {
      prisma.group.findUnique.mockResolvedValueOnce(null);
      await expect(service.findGroupById('non-existent', actor('school', ['groups:read']))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findAllGroups (#89)', () => {
    it('scopes groups to caller school filter at database level', async () => {
      const result = await service.findAllGroups(actor('school', ['groups:read']));
      expect(prisma.group.findMany).toHaveBeenCalledWith({
        where: { schoolId: { in: ['school-a'] } },
        orderBy: { name: 'asc' },
      });
      expect(result).toHaveLength(1);
    });

    it('allows platform admin to list all groups across all schools when no schoolId is provided', async () => {
      await service.findAllGroups(actor('platform', ['groups:read']));
      expect(prisma.group.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { name: 'asc' },
      });
    });

    it('allows querying a specific school within caller scope', async () => {
      await service.findAllGroups(actor('school', ['groups:read']), 'school-a');
      expect(prisma.group.findMany).toHaveBeenCalledWith({
        where: { schoolId: 'school-a' },
        orderBy: { name: 'asc' },
      });
    });

    it('throws 403 Forbidden when school admin queries another school', async () => {
      await expect(
        service.findAllGroups(actor('school', ['groups:read']), 'school-other'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
