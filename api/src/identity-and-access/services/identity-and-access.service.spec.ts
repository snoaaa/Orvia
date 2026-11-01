import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityAndAccessService } from '../../../src/identity-and-access/services/identity-and-access.service.js';

describe('IdentityAndAccessService.createUser', () => {
  let service: IdentityAndAccessService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockDomainValidation: any;

  const actor = {
    id: 'admin-id',
    role: 'PLATFORM_ADMIN',
    schoolId: null,
    assignments: [
      {
        role: 'PLATFORM_ADMIN',
        scope: 'platform',
        schoolId: null,
        permissions: ['users:invite', 'users:assign_role'],
      },
    ],
    permissions: ['users:invite', 'users:assign_role'],
    schoolIds: [],
    isPlatformAdmin: true,
  } as any;
  const context = { ip: '127.0.0.1', userAgent: 'test', deviceId: null };

  beforeEach(() => {
    const tx = {
      user: {
        create: vi.fn(({ data }: any) =>
          Promise.resolve({
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
      },
      userAssignment: { create: vi.fn().mockResolvedValue({}) },
    };
    mockPrisma = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      school: { findUnique: vi.fn().mockResolvedValue({ id: 'school-1' }) },
      role: { findUnique: vi.fn().mockResolvedValue({ id: 'student-role', name: 'STUDENT', scope: 'school' }) },
      $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    mockAudit = { record: vi.fn().mockResolvedValue(undefined) };
    mockDomainValidation = {
      extractDomain: vi.fn((email: string) => email.split('@')[1] ?? null),
      validateDomainForSchool: vi.fn().mockResolvedValue({ allowed: null, schoolId: 'school-1', domain: null }),
    };
    service = new IdentityAndAccessService(mockPrisma, mockAudit, {} as any, mockDomainValidation);
  });

  it('rejects a user whose email domain is not allowed by the assigned school', async () => {
    mockDomainValidation.validateDomainForSchool.mockResolvedValue({
      allowed: false,
      schoolId: 'school-1',
      domain: null,
    });

    await expect(
      service.createUser({ email: 'jane@other.edu', fullName: 'Jane Doe', schoolId: 'school-1' }, actor, context),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates an invited user when the school has no configured domains', async () => {
    const result = await service.createUser(
      { email: 'jane@any.edu', fullName: 'Jane Doe', schoolId: 'school-1', authProvider: 'google' },
      actor,
      context,
    );

    expect(result.status).toBe('INVITED');
    expect(result.authProvider).toBe('google');
    expect(mockDomainValidation.validateDomainForSchool).toHaveBeenCalledWith('any.edu', 'school-1');
    expect(mockAudit.record).toHaveBeenCalled();
  });
});