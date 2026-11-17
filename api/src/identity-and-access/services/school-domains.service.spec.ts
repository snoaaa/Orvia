import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { SchoolDomainsService } from './school-domains.service.js';

const actor = (scope: 'platform' | 'school', permissions = ['schools:read', 'schools:update']) =>
  ({
    id: 'actor',
    isPlatformAdmin: scope === 'platform',
    permissions,
    schoolIds: ['school-a'],
    assignments: [{ role: 'ADMIN', scope, schoolId: 'school-a', schoolStatus: 'active', groupId: null, permissions }],
  }) as unknown as AuthenticatedUser;

describe('SchoolDomainsService (#32)', () => {
  const prisma = {
    school: { findUnique: vi.fn(), update: vi.fn() },
    schoolDomain: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const service = new SchoolDomainsService(prisma as unknown as PrismaService);
  const admin = actor('school');
  const row = { id: 'd1', schoolId: 'school-a', domain: 'school.edu', createdAt: new Date() };

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.school.findUnique.mockResolvedValue({ id: 'school-a' });
    prisma.schoolDomain.findFirst.mockResolvedValue(null);
    prisma.schoolDomain.findMany.mockResolvedValue([{ domain: 'old.edu' }, { domain: 'school.edu' }]);
    prisma.schoolDomain.create.mockResolvedValue(row);
    prisma.schoolDomain.deleteMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((run: (tx: typeof prisma) => Promise<unknown>) => run(prisma));
  });

  it('adds a domain and refreshes the allowed_domains text copy', async () => {
    expect(await service.addDomain('school-a', { domain: 'school.edu' }, admin)).toEqual(row);
    expect(prisma.schoolDomain.create).toHaveBeenCalledWith({ data: { schoolId: 'school-a', domain: 'school.edu' } });
    expect(prisma.school.update).toHaveBeenCalledWith({
      where: { id: 'school-a' },
      data: { allowedDomains: 'old.edu,school.edu' },
    });
  });

  it('rejects a domain this school already has', async () => {
    prisma.schoolDomain.findFirst.mockResolvedValueOnce(row);
    await expect(service.addDomain('school-a', { domain: 'school.edu' }, admin)).rejects.toThrow(
      "Domain 'school.edu' is already allowed for this school",
    );
    expect(prisma.schoolDomain.create).not.toHaveBeenCalled();
  });

  it('rejects a domain overlapping another school', async () => {
    prisma.schoolDomain.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ domain: 'school.edu' });
    await expect(service.addDomain('school-a', { domain: 'cs.school.edu' }, admin)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.schoolDomain.create).not.toHaveBeenCalled();
  });

  it('turns a simultaneous insert (unique index) into a 409', async () => {
    prisma.schoolDomain.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }),
    );
    await expect(service.addDomain('school-a', { domain: 'school.edu' }, admin)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects another school before reading anything, and an unknown school', async () => {
    await expect(service.addDomain('school-b', { domain: 'x.edu' }, admin)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.school.findUnique).not.toHaveBeenCalled();
    prisma.school.findUnique.mockResolvedValueOnce(null);
    await expect(service.listDomains('school-a', admin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists the domains with their ids', async () => {
    prisma.schoolDomain.findMany.mockResolvedValueOnce([row]);
    expect(await service.listDomains('school-a', admin)).toEqual([row]);
    expect(prisma.schoolDomain.findMany.mock.calls[0][0]).toEqual({ where: { schoolId: 'school-a' }, orderBy: { domain: 'asc' } });
  });

  it('removes a domain of the school and refreshes the text copy', async () => {
    await service.removeDomain('school-a', 'd1', admin);
    expect(prisma.schoolDomain.deleteMany).toHaveBeenCalledWith({ where: { id: 'd1', schoolId: 'school-a' } });
    expect(prisma.school.update).toHaveBeenCalled();
  });

  it('answers 404 for a domain that is not one of this school', async () => {
    prisma.schoolDomain.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.removeDomain('school-a', 'd9', admin)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.school.update).not.toHaveBeenCalled();
  });

  it('lets a platform admin act on any school', async () => {
    await service.removeDomain('school-z', 'd1', actor('platform'));
    expect(prisma.schoolDomain.deleteMany).toHaveBeenCalledWith({ where: { id: 'd1', schoolId: 'school-z' } });
  });
});
