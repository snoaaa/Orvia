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
    group: { create: vi.fn(), count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    groupMember: { deleteMany: vi.fn() },
    documentAccess: { deleteMany: vi.fn() },
    userAssignment: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const service = new GroupsService(prisma as unknown as PrismaService);
  const dto = { schoolId: 'school-a', name: 'Class 4-A' };

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.school.findUnique.mockResolvedValue({ status: 'active' });
    prisma.group.create.mockImplementation(({ data }) => Promise.resolve({ id: 'group-1', ...data }));
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

  describe('listGroups', () => {
    const row = (id: string, schoolId: string) => ({
      id,
      schoolId,
      name: id,
      type: 'class',
      createdAt: new Date(),
      updatedAt: new Date(),
      school: { name: `School ${schoolId}`, status: 'active' },
      _count: { members: 2 },
    });

    beforeEach(() => {
      prisma.group.count.mockResolvedValue(1);
      prisma.group.findMany.mockResolvedValue([row('g1', 'school-a')]);
    });

    it('confines a school admin to their schools and maps the member count', async () => {
      const page = await service.listGroups(actor('school', ['groups:read']), { limit: 5 });
      const args = prisma.group.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ deletedAt: null, schoolId: { in: ['school-a'] } });
      expect(args.take).toBe(5);
      expect(page).toMatchObject({ total: 1, page: 1, limit: 5, totalPages: 1 });
      expect(page.data[0]).toMatchObject({ id: 'g1', schoolName: 'School school-a', memberCount: 2 });
    });

    it('does not restrict a platform admin, and sorts text columns A-Z by default', async () => {
      await service.listGroups(actor('platform', ['groups:read']), { sortBy: 'name', type: 'team', search: 'isi' });
      const args = prisma.group.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ deletedAt: null, type: 'team', name: { contains: 'isi' } });
      expect(args.orderBy).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    });

    it('sorts by newest first by default', async () => {
      await service.listGroups(actor('platform', ['groups:read']));
      expect(prisma.group.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    });

    it('rejects a filter on another school', async () => {
      await expect(
        service.listGroups(actor('school', ['groups:read']), { schoolId: 'school-b' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getGroup and updateGroup', () => {
    const existing = (schoolId = 'school-a', status = 'active') => ({
      id: 'g1',
      schoolId,
      name: 'Class 4-A',
      type: 'class',
      createdAt: new Date(),
      updatedAt: new Date(),
      school: { name: 'School A', status },
      _count: { members: 3 },
    });

    beforeEach(() => {
      prisma.group.findFirst.mockResolvedValue(existing());
      prisma.group.update.mockImplementation(({ data }) => Promise.resolve({ ...existing(), ...data }));
    });

    it('returns a group of the admin school with its member count', async () => {
      expect(await service.getGroup('g1', actor('school', ['groups:read']))).toMatchObject({ memberCount: 3 });
    });

    it('answers 404 for an unknown group and 403 for another school', async () => {
      prisma.group.findFirst.mockResolvedValueOnce(null);
      await expect(service.getGroup('g1', actor('platform', ['groups:read']))).rejects.toBeInstanceOf(NotFoundException);
      prisma.group.findFirst.mockResolvedValueOnce(existing('school-b'));
      await expect(service.getGroup('g1', actor('school', ['groups:read']))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('updates the name and type', async () => {
      const group = await service.updateGroup('g1', { name: 'Class 4-B', type: 'team' }, actor('school', ['groups:update']));
      expect(prisma.group.update.mock.calls[0][0].data).toEqual({ name: 'Class 4-B', type: 'team' });
      expect(group).toMatchObject({ name: 'Class 4-B', type: 'team' });
    });

    it('does not write when nothing changes', async () => {
      await service.updateGroup('g1', { name: 'Class 4-A', type: 'class' }, actor('school', ['groups:update']));
      expect(prisma.group.update).not.toHaveBeenCalled();
    });

    it('rejects an empty update, a deactivated school and another school', async () => {
      const admin = actor('school', ['groups:update']);
      await expect(service.updateGroup('g1', {}, admin)).rejects.toBeInstanceOf(BadRequestException);
      prisma.group.findFirst.mockResolvedValueOnce(existing('school-a', 'deactivated'));
      await expect(service.updateGroup('g1', { name: 'X' }, admin)).rejects.toBeInstanceOf(BadRequestException);
      prisma.group.findFirst.mockResolvedValueOnce(existing('school-b'));
      await expect(service.updateGroup('g1', { name: 'X' }, admin)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.group.update).not.toHaveBeenCalled();
    });

    it('turns a duplicate name into a 409', async () => {
      prisma.group.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }),
      );
      await expect(
        service.updateGroup('g1', { name: 'Taken' }, actor('school', ['groups:update'])),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('deleteGroup', () => {
    const existing = (overrides: Record<string, unknown> = {}) => ({
      id: 'g1',
      schoolId: 'school-a',
      name: 'Class 4-A',
      type: 'class',
      createdAt: new Date(),
      updatedAt: new Date(),
      school: { name: 'School A', status: 'active' },
      _count: { members: 3 },
      ...overrides,
    });
    const admin = actor('school', ['groups:delete']);

    beforeEach(() => {
      prisma.group.findFirst.mockResolvedValue(existing());
      prisma.group.updateMany.mockResolvedValue({ count: 1 });
      prisma.$transaction.mockImplementation((run: (tx: typeof prisma) => Promise<unknown>) => run(prisma));
    });

    it('soft deletes and renames the group, removes memberships and access, keeps assignments', async () => {
      await service.deleteGroup('g1', admin);
      const { where, data } = prisma.group.updateMany.mock.calls[0][0];
      expect(where).toEqual({ id: 'g1', deletedAt: null });
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.name).toBe(`Class 4-A [deleted ${data.deletedAt.toISOString()}]`);
      expect(data.updatedAt).toBe(data.deletedAt);
      expect(prisma.groupMember.deleteMany).toHaveBeenCalledWith({ where: { groupId: 'g1' } });
      expect(prisma.documentAccess.deleteMany).toHaveBeenCalledWith({ where: { groupId: 'g1' } });
      expect(prisma.userAssignment.updateMany).toHaveBeenCalledWith({ where: { groupId: 'g1' }, data: { groupId: null } });
    });

    it('never splits an emoji when shortening the name', async () => {
      prisma.group.findFirst.mockResolvedValue(existing({ name: '😀'.repeat(191) }));
      await service.deleteGroup('g1', admin);
      const { data } = prisma.group.updateMany.mock.calls[0][0];
      const characters = Array.from(data.name as string);
      expect(characters).toHaveLength(191);
      expect(data.name).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    });

    it('keeps the renamed name within 191 characters', async () => {
      prisma.group.findFirst.mockResolvedValue(existing({ name: 'x'.repeat(191) }));
      await service.deleteGroup('g1', admin);
      const { data } = prisma.group.updateMany.mock.calls[0][0];
      expect(data.name).toHaveLength(191);
      expect(data.name.endsWith(']')).toBe(true);
    });

    it('answers 404 for an unknown or already deleted group', async () => {
      prisma.group.findFirst.mockResolvedValue(null);
      await expect(service.deleteGroup('g1', admin)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.group.findFirst.mock.calls[0][0].where).toEqual({ id: 'g1', deletedAt: null });
    });

    it('answers 404 when a simultaneous delete won, without touching memberships', async () => {
      prisma.group.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.deleteGroup('g1', admin)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.groupMember.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects another school and a deactivated school', async () => {
      prisma.group.findFirst.mockResolvedValueOnce(existing({ schoolId: 'school-b' }));
      await expect(service.deleteGroup('g1', admin)).rejects.toBeInstanceOf(ForbiddenException);
      prisma.group.findFirst.mockResolvedValueOnce(existing({ school: { name: 'School A', status: 'deactivated' } }));
      await expect(service.deleteGroup('g1', admin)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('hides deleted groups from the list', async () => {
      prisma.group.count.mockResolvedValue(0);
      prisma.group.findMany.mockResolvedValue([]);
      await service.listGroups(actor('platform', ['groups:read']));
      expect(prisma.group.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
    });
  });
});
