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
        permissions: ['users:invite', 'users:assign_role', 'users:read', 'users:update', 'schools:create', 'schools:read', 'schools:update', 'schools:delete'],
      },
    ],
    permissions: ['users:invite', 'users:assign_role', 'users:read', 'users:update', 'schools:create', 'schools:read', 'schools:update', 'schools:delete'],
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
        permissions: ['users:invite', 'users:read', 'schools:read', 'schools:update'],
      },
    ],
    permissions: ['users:invite', 'users:read', 'schools:read', 'schools:update'],
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
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }: { data: any }) =>
          Promise.resolve({
            ...data,
            id: data.id || 'generated-school-id',
            status: data.status || 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
            domains: data.domains?.create || [],
          }),
        ),
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'school-1',
            name: 'School school-1',
            status: 'active',
            allowedDomains: '',
            settings: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            domains: [],
          },
          {
            id: 'school-2',
            name: 'School school-2',
            status: 'active',
            allowedDomains: '',
            settings: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            domains: [],
          },
        ]),
        update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: any }) =>
          Promise.resolve({
            id: where.id,
            name: data.name ?? `School ${where.id}`,
            status: 'active',
            allowedDomains: '',
            settings: data.settings ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
            domains: [],
          }),
        ),
      },
      schoolDomain: {
        findFirst: vi.fn().mockResolvedValue(null),
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
          if (where.name === 'SCHOOL_ADMIN') {
            return Promise.resolve({ id: 'role-school-admin-id', name: 'SCHOOL_ADMIN', scope: 'school' });
          }
          return Promise.resolve(null);
        }),
      },
      userAssignment: {
        create: vi.fn().mockResolvedValue({}),
      },
      passwordSetupToken: {
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
          passwordSetupToken: {
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

    it('generates a setup token when inviting an administrator (Issue #26)', async () => {
      const result = await service.inviteUser(
        { email: 'newadmin@school1.edu', fullName: 'New Admin', schoolId: 'school-1', role: 'SCHOOL_ADMIN' },
        schoolAdmin,
        fakeContext,
      );

      expect(result).toBeDefined();
      expect(result.authProvider).toBe('local');
      expect(result.status).toBe('INVITED');
      expect(result.setupToken).toBeDefined();
      expect(result.setupToken).toMatch(/^[0-9a-f]{64}$/);
      expect(result.setupTokenExpiresAt).toBeInstanceOf(Date);
    });

    it('does not generate a setup token when inviting a student (authenticates with Google)', async () => {
      const result = await service.inviteUser(
        { email: 'newstudent@school1.edu', fullName: 'New Student', schoolId: 'school-1', role: 'STUDENT' },
        schoolAdmin,
        fakeContext,
      );

      expect(result).toBeDefined();
      expect(result.authProvider).toBe('google');
      expect(result.status).toBe('INVITED');
      expect(result.setupToken).toBeUndefined();
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
  describe('createSchool - Acceptance criteria (Issue #27)', () => {
    it('creates a school with status active when called by platform admin', async () => {
      const dto = {
        name: 'Alpha Engineering Academy',
        settings: { maxStudents: 500 },
      };

      const result = await service.createSchool(dto, platformAdmin, fakeContext);

      expect(result).toBeDefined();
      expect(result.name).toBe('Alpha Engineering Academy');
      expect(result.status).toBe('active');
      expect(result.settings).toEqual({ maxStudents: 500 });
      expect(mockPrisma.school.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Alpha Engineering Academy',
            status: 'active',
            settings: { maxStudents: 500 },
          }),
        }),
      );
    });

    it('preserves provided status active and trims whitespace from school name', async () => {
      const dto = {
        name: '   Beta Science College   ',
        status: 'active',
      };

      const result = await service.createSchool(dto, platformAdmin, fakeContext);

      expect(result.name).toBe('Beta Science College');
      expect(result.status).toBe('active');
      expect(mockPrisma.school.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Beta Science College',
            status: 'active',
          }),
        }),
      );
    });

    it('rejects duplicate school name with 409 ConflictException', async () => {
      mockPrisma.school.findFirst.mockResolvedValueOnce({
        id: 'existing-school-id',
        name: 'Alpha Engineering Academy',
      });

      const dto = {
        name: 'Alpha Engineering Academy',
      };

      await expect(service.createSchool(dto, platformAdmin, fakeContext)).rejects.toThrow(
        new ConflictException("School with name 'Alpha Engineering Academy' already exists"),
      );
    });

    it('rejects school creation by non-platform admin with 403 ForbiddenException', async () => {
      const dto = {
        name: 'Unauthorized School',
      };

      await expect(service.createSchool(dto, schoolAdmin, fakeContext)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.createSchool(dto, schoolAdmin, fakeContext)).rejects.toThrow(
        'Only a platform administrator can create a school',
      );
    });

    it('rejects empty or whitespace-only school name with 400 BadRequestException', async () => {
      await expect(service.createSchool({ name: '' }, platformAdmin, fakeContext)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.createSchool({ name: '   ' }, platformAdmin, fakeContext)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects duplicate school domain with 409 ConflictException', async () => {
      mockPrisma.schoolDomain.findFirst.mockResolvedValueOnce({
        id: 'existing-domain-id',
        domain: 'alpha.edu',
      });

      const dto = {
        name: 'Unique School Name',
        allowedDomains: 'alpha.edu',
      };

      await expect(service.createSchool(dto, platformAdmin, fakeContext)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
  describe('findAllSchools & findSchoolById - Acceptance criteria (Issue #29)', () => {
    describe('findAllSchools', () => {
      it('allows platform admin to see all schools with pagination', async () => {
        const query = { page: 1, limit: 10, status: 'active', search: 'School' };
        const result = await service.findAllSchools(platformAdmin, query);

        expect(result).toBeDefined();
        expect(result.data.length).toBe(2);
        expect(result.total).toBe(2);
        expect(result.page).toBe(1);
        expect(result.limit).toBe(10);
        expect(result.totalPages).toBe(1);

        expect(mockPrisma.school.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              status: 'active',
              name: { contains: 'School' },
            }),
            skip: 0,
            take: 10,
          }),
        );
      });

      it('scopes school list query to school admin assigned schools', async () => {
        await service.findAllSchools(schoolAdmin, { page: 1, limit: 10 });

        expect(mockPrisma.school.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: { in: ['school-1'] },
            }),
          }),
        );
      });
    });

    describe('findSchoolById', () => {
      it('allows platform admin to read any school by ID', async () => {
        const result = await service.findSchoolById('school-2', platformAdmin);

        expect(result).toBeDefined();
        expect(result.id).toBe('school-2');
        expect(result.name).toBe('School school-2');
      });

      it('allows school admin to read their own assigned school', async () => {
        const result = await service.findSchoolById('school-1', schoolAdmin);

        expect(result).toBeDefined();
        expect(result.id).toBe('school-1');
      });

      it('rejects school admin reading another school with 403 Forbidden', async () => {
        await expect(service.findSchoolById('school-2', schoolAdmin)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        await expect(service.findSchoolById('school-2', schoolAdmin)).rejects.toThrow(
          'You do not have access to this school',
        );
      });

      it('throws 404 NotFoundException if school does not exist', async () => {
        await expect(service.findSchoolById('school-nonexistent', platformAdmin)).rejects.toBeInstanceOf(
          NotFoundException,
        );
      });
    });
  });
  describe('updateSchool - Acceptance criteria (Issue #30)', () => {
    it('allows platform admin to update any school name and settings', async () => {
      const dto = {
        name: 'Updated School 2',
        settings: { maxUsers: 1500 },
      };

      const result = await service.updateSchool('school-2', dto, platformAdmin, fakeContext);

      expect(result).toBeDefined();
      expect(result.id).toBe('school-2');
      expect(result.name).toBe('Updated School 2');
      expect(result.settings).toEqual({ maxUsers: 1500 });
      expect(mockPrisma.school.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'school-2' },
          data: expect.objectContaining({
            name: 'Updated School 2',
            settings: { maxUsers: 1500 },
          }),
        }),
      );
    });

    it('allows school admin to update their own assigned school', async () => {
      const dto = {
        settings: { maxUsers: 800 },
      };

      const result = await service.updateSchool('school-1', dto, schoolAdmin, fakeContext);

      expect(result).toBeDefined();
      expect(result.id).toBe('school-1');
      expect(result.settings).toEqual({ maxUsers: 800 });
    });

    it('rejects school admin updating another school with 403 ForbiddenException', async () => {
      const dto = {
        name: 'Hacked Name',
      };

      await expect(service.updateSchool('school-2', dto, schoolAdmin, fakeContext)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.updateSchool('school-2', dto, schoolAdmin, fakeContext)).rejects.toThrow(
        'You do not have access to this school',
      );
    });

    it('rejects duplicate school name if already used by another school with 409 ConflictException', async () => {
      mockPrisma.school.findFirst.mockResolvedValueOnce({
        id: 'different-school-id',
        name: 'Conflicting School Name',
      });

      const dto = {
        name: 'Conflicting School Name',
      };

      await expect(service.updateSchool('school-1', dto, schoolAdmin, fakeContext)).rejects.toThrow(
        new ConflictException("School with name 'Conflicting School Name' already exists"),
      );
    });

    it('allows school to retain its current name without throwing conflict', async () => {
      mockPrisma.school.findFirst.mockResolvedValueOnce({
        id: 'school-1',
        name: 'School school-1',
      });

      const dto = {
        name: 'School school-1',
        settings: { updatedSetting: true },
      };

      const result = await service.updateSchool('school-1', dto, schoolAdmin, fakeContext);
      expect(result).toBeDefined();
      expect(result.id).toBe('school-1');
    });

    it('rejects empty or whitespace-only school name with 400 BadRequestException', async () => {
      await expect(service.updateSchool('school-1', { name: '' }, schoolAdmin, fakeContext)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.updateSchool('school-1', { name: '   ' }, schoolAdmin, fakeContext)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws 404 NotFoundException if target school does not exist', async () => {
      await expect(service.updateSchool('school-nonexistent', { name: 'Name' }, platformAdmin, fakeContext)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('deactivateSchool & reactivateSchool - Acceptance criteria (Issue #31)', () => {
    describe('deactivateSchool', () => {
      it('allows platform admin to deactivate a school (sets status to deactivated)', async () => {
        const result = await service.deactivateSchool('school-1', platformAdmin, fakeContext);

        expect(result).toBeDefined();
        expect(result.id).toBe('school-1');
        expect(mockPrisma.school.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'school-1' },
            data: { status: 'deactivated' },
          }),
        );
      });

      it('rejects school admin deactivating a school with 403 ForbiddenException', async () => {
        await expect(service.deactivateSchool('school-1', schoolAdmin, fakeContext)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        await expect(service.deactivateSchool('school-1', schoolAdmin, fakeContext)).rejects.toThrow(
          'Only platform administrators may deactivate schools',
        );
      });

      it('throws 404 NotFoundException if school to deactivate does not exist', async () => {
        await expect(service.deactivateSchool('school-nonexistent', platformAdmin, fakeContext)).rejects.toBeInstanceOf(
          NotFoundException,
        );
      });
    });

    describe('reactivateSchool', () => {
      it('allows platform admin to reactivate a school (sets status to active)', async () => {
        const result = await service.reactivateSchool('school-1', platformAdmin, fakeContext);

        expect(result).toBeDefined();
        expect(result.id).toBe('school-1');
        expect(mockPrisma.school.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'school-1' },
            data: { status: 'active' },
          }),
        );
      });

      it('rejects school admin reactivating a school with 403 ForbiddenException', async () => {
        await expect(service.reactivateSchool('school-1', schoolAdmin, fakeContext)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        await expect(service.reactivateSchool('school-1', schoolAdmin, fakeContext)).rejects.toThrow(
          'Only platform administrators may reactivate schools',
        );
      });

      it('throws 404 NotFoundException if school to reactivate does not exist', async () => {
        await expect(service.reactivateSchool('school-nonexistent', platformAdmin, fakeContext)).rejects.toBeInstanceOf(
          NotFoundException,
        );
      });
    });
  });
});
