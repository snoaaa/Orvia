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
    group: { create: vi.fn() },
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
});
