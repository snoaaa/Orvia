import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { IdentityAndAccessService } from './identity-and-access.service.js';

describe('IdentityAndAccessService - User Invitation (Issue #9)', () => {
  let service: IdentityAndAccessService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockSessions: any;
  let mockDomainValidation: any;

  const fakeContext = { ip: '127.0.0.1', userAgent: 'test-agent', deviceId: null };

  const platformAdmin: AuthenticatedUser = {
    id: 'platform-admin-id',
    email: 'admin@platform.gov',
    fullName: 'Platform Admin',
    status: 'ACTIVE',
    assignments: [
      {
        role: 'PLATFORM_ADMIN',
        scope: 'platform',
        schoolId: 'school-1',
        groupId: null,
        permissions: ['users:invite', 'users:assign_role', 'users:read', 'users:update'],
      },
    ],
    permissions: ['users:invite', 'users:assign_role', 'users:read', 'users:update'],
    schoolIds: ['school-1'],
    isPlatformAdmin: true,
    role: 'PLATFORM_ADMIN',
    schoolId: 'school-1',
    sessionId: null,
  };

  const schoolAdmin: AuthenticatedUser = {
    id: 'school-admin-id',
    email: 'admin@school1.edu',
    fullName: 'School Admin',
    status: 'ACTIVE',
    assignments: [
      {
        role: 'SCHOOL_ADMIN',
        scope: 'school',
        schoolId: 'school-1',
        groupId: null,
        permissions: ['users:invite', 'users:read'],
      },
    ],
    permissions: ['users:invite', 'users:read'],
    schoolIds: ['school-1'],
    isPlatformAdmin: false,
    role: 'SCHOOL_ADMIN',
    schoolId: 'school-1',
    sessionId: null,
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      school: {
        findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          if (where.id === 'school-1' || where.id === 'school-2') {
            return Promise.resolve({ id: where.id, name: `School ${where.id}` });
          }
          return Promise.resolve(null);
        }),
      },
      role: {
        findUnique: vi.fn().mockImplementation(({ where }: { where: { name: string } }) => {
          if (where.name === 'STUDENT') {
            return Promise.resolve({ id: 'role-student-id', name: 'STUDENT', scope: 'school' });
          }
          if (where.name === 'TEACHER') {
            return Promise.resolve({ id: 'role-teacher-id', name: 'TEACHER', scope: 'school' });
          }
          if (where.name === 'PLATFORM_ADMIN') {
            return Promise.resolve({ id: 'role-platform-id', name: 'PLATFORM_ADMIN', scope: 'platform' });
          }
          return Promise.resolve(null);
        }),
      },
      userAssignment: {
        create: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn().mockImplementation(async (callback: any) => {
        const tx = {
          user: {
            create: vi.fn().mockImplementation(({ data }: { data: any }) =>
              Promise.resolve({
                ...data,
                id: data.id || 'generated-uuid',
                createdAt: new Date(),
                updatedAt: new Date(),
              }),
            ),
          },
          userAssignment: {
            create: vi.fn().mockResolvedValue({}),
          },
        };
        return callback(tx);
      }),
    };

    mockAudit = {
      record: vi.fn().mockResolvedValue(undefined),
    };

    mockSessions = {
      revokeAllForUser: vi.fn().mockResolvedValue(undefined),
    };

    mockDomainValidation = {
      extractDomain: vi.fn().mockImplementation((email: string) => {
        const parts = email.split('@');
        return parts.length === 2 ? parts[1].toLowerCase() : null;
      }),
      validateDomainForSchool: vi.fn().mockResolvedValue({
        allowed: true,
        schoolId: 'school-1',
        domain: 'school1.edu',
      }),
    };

    service = new IdentityAndAccessService(
      mockPrisma,
      mockAudit,
      mockSessions,
      mockDomainValidation,
    );
  });

  describe('inviteUser', () => {
    it('creates an invited user with status INVITED, authProvider google, no password, and links to school', async () => {
      const result = await service.inviteUser(
        { email: 'student@school1.edu', fullName: 'Student One', schoolId: 'school-1' },
        schoolAdmin,
        fakeContext,
      );

      expect(result).toBeDefined();
      expect(result.email).toBe('student@school1.edu');
      expect(result.fullName).toBe('Student One');
      expect(result.status).toBe('INVITED');
      expect(result.authProvider).toBe('google');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'identity_access',
          action: 'user_invited',
        }),
      );
    });

    it('assigns the default STUDENT role when no role is specified', async () => {
      await service.inviteUser(
        { email: 'student@school1.edu', fullName: 'Student One', schoolId: 'school-1' },
        schoolAdmin,
        fakeContext,
      );

      expect(mockPrisma.role.findUnique).toHaveBeenCalledWith({ where: { name: 'STUDENT' } });
    });

    it('assigns custom specified role when valid for the school', async () => {
      await service.inviteUser(
        { email: 'teacher@school1.edu', fullName: 'Teacher One', schoolId: 'school-1', role: 'TEACHER' },
        schoolAdmin,
        fakeContext,
      );

      expect(mockPrisma.role.findUnique).toHaveBeenCalledWith({ where: { name: 'TEACHER' } });
    });

    it('rejects duplicate email with 409 Conflict', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing-id', email: 'existing@school1.edu' });

      await expect(
        service.inviteUser(
          { email: 'existing@school1.edu', fullName: 'Existing User', schoolId: 'school-1' },
          schoolAdmin,
          fakeContext,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when school domain validation returns allowed = false', async () => {
      mockDomainValidation.validateDomainForSchool.mockResolvedValue({
        allowed: false,
        schoolId: 'school-1',
        domain: 'gmail.com',
      });

      await expect(
        service.inviteUser(
          { email: 'intruder@gmail.com', fullName: 'Intruder', schoolId: 'school-1' },
          schoolAdmin,
          fakeContext,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows invitation when school has zero configured domains (allowed = null)', async () => {
      mockDomainValidation.validateDomainForSchool.mockResolvedValue({
        allowed: null,
        schoolId: 'school-1',
        domain: 'anydomain.com',
      });

      const result = await service.inviteUser(
        { email: 'external@anydomain.com', fullName: 'External User', schoolId: 'school-1' },
        schoolAdmin,
        fakeContext,
      );

      expect(result.status).toBe('INVITED');
      expect(result.email).toBe('external@anydomain.com');
    });

    it('throws 403 Forbidden when school admin attempts to invite into a school they do not manage', async () => {
      await expect(
        service.inviteUser(
          { email: 'student@school2.edu', fullName: 'Student Two', schoolId: 'school-2' },
          schoolAdmin,
          fakeContext,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws 400 BadRequest when school admin does not provide schoolId', async () => {
      await expect(
        service.inviteUser(
          { email: 'student@school1.edu', fullName: 'Student' },
          schoolAdmin,
          fakeContext,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 BadRequest when role is specified without schoolId', async () => {
      await expect(
        service.inviteUser(
          { email: 'user@platform.gov', fullName: 'User', role: 'STUDENT' },
          platformAdmin,
          fakeContext,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 404 NotFound if school does not exist', async () => {
      await expect(
        service.inviteUser(
          { email: 'user@nonexistent.edu', fullName: 'User', schoolId: 'school-nonexistent' },
          platformAdmin,
          fakeContext,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 400 BadRequest if role name is unknown', async () => {
      await expect(
        service.inviteUser(
          { email: 'user@school1.edu', fullName: 'User', schoolId: 'school-1', role: 'NONEXISTENT_ROLE' },
          platformAdmin,
          fakeContext,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws 403 Forbidden when school admin attempts to assign a platform-scoped role', async () => {
      await expect(
        service.inviteUser(
          { email: 'user@school1.edu', fullName: 'User', schoolId: 'school-1', role: 'PLATFORM_ADMIN' },
          schoolAdmin,
          fakeContext,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('createUser - domain validation integration', () => {
    it('validates email domain for school when schoolId is provided in createUser', async () => {
      mockDomainValidation.validateDomainForSchool.mockResolvedValue({
        allowed: false,
        schoolId: 'school-1',
        domain: 'unauthorized.com',
      });

      await expect(
        service.createUser(
          {
            email: 'user@unauthorized.com',
            fullName: 'Unauthorized User',
            schoolId: 'school-1',
            authProvider: 'local',
            password: 'ValidPassword123!',
          },
          schoolAdmin,
          fakeContext,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

