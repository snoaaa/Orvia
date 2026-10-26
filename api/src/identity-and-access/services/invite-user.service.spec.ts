import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InviteUserService } from '../../../src/identity-and-access/services/invite-user.service.js';

/**
 * Unit tests for InviteUserService (Issue #9).
 */
describe('InviteUserService', () => {
  let service: InviteUserService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockDomainValidation: any;

  const fakeContext = { ip: '127.0.0.1', userAgent: 'test', deviceId: null };

  /** Platform admin actor with all permissions. */
  const platformAdmin = {
    id: 'admin-id',
    email: 'admin@platform.com',
    fullName: 'Admin',
    status: 'ACTIVE' as const,
    assignments: [
      {
        role: 'PLATFORM_ADMIN',
        scope: 'platform',
        schoolId: 's1',
        groupId: null,
        permissions: ['users:invite', 'users:assign_role'],
      },
    ],
    permissions: ['users:invite', 'users:assign_role'],
    schoolIds: ['s1'],
    isPlatformAdmin: true,
    role: 'PLATFORM_ADMIN',
    schoolId: 's1',
    sessionId: null,
  };

  /** School admin actor scoped to school 's1'. */
  const schoolAdmin = {
    id: 'school-admin-id',
    email: 'sa@school.edu',
    fullName: 'School Admin',
    status: 'ACTIVE' as const,
    assignments: [
      {
        role: 'SCHOOL_ADMIN',
        scope: 'school',
        schoolId: 's1',
        groupId: null,
        permissions: ['users:invite'],
      },
    ],
    permissions: ['users:invite'],
    schoolIds: ['s1'],
    isPlatformAdmin: false,
    role: 'SCHOOL_ADMIN',
    schoolId: 's1',
    sessionId: null,
  };

  beforeEach(() => {
    mockPrisma = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      school: { findUnique: vi.fn().mockResolvedValue({ id: 's1' }) },
      role: { findUnique: vi.fn().mockResolvedValue({ id: 'r1', name: 'STUDENT', scope: 'school' }) },
      userAssignment: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn().mockImplementation(async (fn: any) => {
        const txPrisma = {
          user: {
            create: vi.fn().mockResolvedValue({
              id: 'new-user-id',
              email: 'jane@school.edu',
              fullName: 'Jane Doe',
              authProvider: 'google',
              passwordHash: null,
              status: 'INVITED',
              googleSub: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
          },
          userAssignment: { create: vi.fn().mockResolvedValue({}) },
        };
        return fn(txPrisma);
      }),
    };
    mockAudit = { record: vi.fn().mockResolvedValue(undefined) };
    mockDomainValidation = {
      extractDomain: vi.fn().mockReturnValue('school.edu'),
      validateDomainForSchool: vi.fn().mockResolvedValue({ allowed: null, schoolId: 's1', domain: null }),
    };

    service = new InviteUserService(mockPrisma, mockAudit, mockDomainValidation);
  });

  it('creates a user with INVITED status and no password', async () => {
    const result = await service.invite(
      { email: 'jane@school.edu', fullName: 'Jane Doe', schoolId: 's1' },
      platformAdmin,
      fakeContext,
    );
    expect(result.status).toBe('INVITED');
    expect(mockAudit.record).toHaveBeenCalled();
  });

  it('rejects duplicate email with 409 Conflict', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing', email: 'jane@school.edu' });
    await expect(
      service.invite({ email: 'jane@school.edu', fullName: 'Jane', schoolId: 's1' }, platformAdmin, fakeContext),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects email domain not in school_domains', async () => {
    mockDomainValidation.validateDomainForSchool.mockResolvedValue({
      allowed: false,
      schoolId: 's1',
      domain: null,
    });
    await expect(
      service.invite({ email: 'jane@otherdomain.com', fullName: 'Jane', schoolId: 's1' }, platformAdmin, fakeContext),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows invite when school has no configured domains (allowed=null)', async () => {
    mockDomainValidation.validateDomainForSchool.mockResolvedValue({ allowed: null, schoolId: 's1', domain: null });
    const result = await service.invite(
      { email: 'jane@any.com', fullName: 'Jane', schoolId: 's1' },
      platformAdmin,
      fakeContext,
    );
    expect(result.status).toBe('INVITED');
  });

  it('throws 403 when school admin tries to invite into another school', async () => {
    await expect(
      service.invite({ email: 'jane@school.edu', fullName: 'Jane', schoolId: 's2' }, schoolAdmin, fakeContext),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws 400 when school admin provides no schoolId', async () => {
    await expect(
      service.invite({ email: 'jane@school.edu', fullName: 'Jane' }, schoolAdmin, fakeContext),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws 400 for an unknown role', async () => {
    mockPrisma.role.findUnique.mockResolvedValue(null);
    await expect(
      service.invite({ email: 'jane@school.edu', fullName: 'Jane', schoolId: 's1', role: 'WIZARD' }, platformAdmin, fakeContext),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws 403 when school admin tries to assign a platform-scoped role', async () => {
    mockPrisma.role.findUnique.mockResolvedValue({ id: 'r2', name: 'PLATFORM_ADMIN', scope: 'platform' });
    await expect(
      service.invite({ email: 'jane@school.edu', fullName: 'Jane', schoolId: 's1', role: 'PLATFORM_ADMIN' }, schoolAdmin, fakeContext),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
