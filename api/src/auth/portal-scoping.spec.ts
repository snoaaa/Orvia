import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditQueryService } from '../audit/services/audit-query.service.js';
import { DocumentsService } from '../documents/services/documents.service.js';
import { GroupsService } from '../identity-and-access/services/groups.service.js';
import { IdentityAndAccessService } from '../identity-and-access/services/identity-and-access.service.js';
import { RagPerformanceService } from '../rag-performance/services/rag-performance.service.js';
import {
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from './decorators/auth.decorators.js';
import { PermissionsGuard } from './guards/permissions.guard.js';
import type { AuthenticatedUser } from './types/authenticated-user.js';

describe('Portal Endpoints Role and School Scoping (§4.5, §4.7, #89)', () => {
  let reflector: Reflector;
  let guard: PermissionsGuard;

  // 1. Platform Admin: platform-wide access, bypasses school boundaries
  const platformAdmin: AuthenticatedUser = {
    id: 'user-platform-admin',
    sessionId: 'sess-pa',
    email: 'admin@orvia.internal',
    fullName: 'Platform Admin',
    status: 'ACTIVE',
    isPlatformAdmin: true,
    roles: ['PLATFORM_ADMIN'],
    role: 'PLATFORM_ADMIN',
    permissions: ['*'],
    schoolIds: [],
    assignments: [
      {
        role: 'PLATFORM_ADMIN',
        scope: 'platform',
        schoolId: null,
        schoolStatus: null,
        groupId: null,
        permissions: ['*'],
      },
    ],
  };

  // 2. School Admin (School 1): full management inside school-1, forbidden in school-2
  const school1Admin: AuthenticatedUser = {
    id: 'user-school1-admin',
    sessionId: 'sess-s1-admin',
    email: 'admin@school1.edu',
    fullName: 'School 1 Admin',
    status: 'ACTIVE',
    isPlatformAdmin: false,
    roles: ['SCHOOL_ADMIN'],
    role: 'SCHOOL_ADMIN',
    permissions: [
      'users:read',
      'users:update',
      'users:assign_role',
      'schools:read',
      'schools:update',
      'groups:read',
      'groups:create',
      'spaces:read',
      'spaces:create',
      'documents:manage',
      'documents:read',
      'documents:create',
      'documents:update',
      'documents:delete',
      'audit:read',
      'metrics:view',
    ],
    schoolIds: ['school-1'],
    assignments: [
      {
        role: 'SCHOOL_ADMIN',
        scope: 'school',
        schoolId: 'school-1',
        schoolStatus: 'active',
        groupId: null,
        permissions: [
          'users:read',
          'users:update',
          'users:assign_role',
          'schools:read',
          'schools:update',
          'groups:read',
          'groups:create',
          'spaces:read',
          'spaces:create',
          'documents:manage',
          'documents:read',
          'documents:create',
          'documents:update',
          'documents:delete',
          'audit:read',
          'metrics:view',
        ],
      },
    ],
  };

  // 3. Staff with Document Management (School 1): can manage docs/spaces in school-1, no user/school/audit admin
  const staffDocManager: AuthenticatedUser = {
    id: 'user-staff-doc-mgr',
    sessionId: 'sess-staff-mgr',
    email: 'docmgr@school1.edu',
    fullName: 'School 1 Doc Manager',
    status: 'ACTIVE',
    isPlatformAdmin: false,
    roles: ['STAFF'],
    role: 'STAFF',
    permissions: ['spaces:read', 'spaces:create', 'documents:manage', 'documents:read', 'documents:create', 'documents:update', 'documents:delete'],
    schoolIds: ['school-1'],
    assignments: [
      {
        role: 'STAFF',
        scope: 'school',
        schoolId: 'school-1',
        schoolStatus: 'active',
        groupId: null,
        permissions: ['spaces:read', 'spaces:create', 'documents:manage', 'documents:read', 'documents:create', 'documents:update', 'documents:delete'],
      },
    ],
  };

  // 4. Regular Staff (School 1): read-only to published docs in school-1 spaces
  const regularStaff: AuthenticatedUser = {
    id: 'user-regular-staff',
    sessionId: 'sess-staff-reg',
    email: 'teacher@school1.edu',
    fullName: 'Regular Teacher',
    status: 'ACTIVE',
    isPlatformAdmin: false,
    roles: ['STAFF'],
    role: 'STAFF',
    permissions: ['spaces:read', 'documents:read'],
    schoolIds: ['school-1'],
    assignments: [
      {
        role: 'STAFF',
        scope: 'school',
        schoolId: 'school-1',
        schoolStatus: 'active',
        groupId: null,
        permissions: ['spaces:read', 'documents:read'],
      },
    ],
  };

  // 5. Student (School 1): can only read published docs granted to them, no admin/portal endpoints
  const studentUser: AuthenticatedUser = {
    id: 'user-student',
    sessionId: 'sess-student',
    email: 'student@school1.edu',
    fullName: 'Student Jane',
    status: 'ACTIVE',
    isPlatformAdmin: false,
    roles: ['STUDENT'],
    role: 'STUDENT',
    permissions: ['documents:read'],
    schoolIds: ['school-1'],
    assignments: [
      {
        role: 'STUDENT',
        scope: 'school',
        schoolId: 'school-1',
        schoolStatus: 'active',
        groupId: 'group-class-a',
        permissions: ['documents:read'],
      },
    ],
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  function createMockContext(user?: Partial<AuthenticatedUser>): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  describe('Endpoint Guard Permission Checks Across Roles', () => {
    function testEndpointAccess(requiredPerms: string[], user: AuthenticatedUser): boolean {
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === REQUIRED_PERMISSIONS_KEY) return requiredPerms;
        return undefined;
      });
      const ctx = createMockContext(user);
      try {
        return guard.canActivate(ctx);
      } catch {
        return false;
      }
    }

    it('Platform Admin can access all portal endpoints', () => {
      expect(testEndpointAccess(['users:read'], platformAdmin)).toBe(true);
      expect(testEndpointAccess(['schools:read'], platformAdmin)).toBe(true);
      expect(testEndpointAccess(['groups:read'], platformAdmin)).toBe(true);
      expect(testEndpointAccess(['audit:read'], platformAdmin)).toBe(true);
      expect(testEndpointAccess(['metrics:view'], platformAdmin)).toBe(true);
      expect(testEndpointAccess(['documents:manage'], platformAdmin)).toBe(true);
    });

    it('School Admin can access administrative and doc endpoints for their school', () => {
      expect(testEndpointAccess(['users:read'], school1Admin)).toBe(true);
      expect(testEndpointAccess(['schools:read'], school1Admin)).toBe(true);
      expect(testEndpointAccess(['groups:read'], school1Admin)).toBe(true);
      expect(testEndpointAccess(['audit:read'], school1Admin)).toBe(true);
      expect(testEndpointAccess(['metrics:view'], school1Admin)).toBe(true);
      expect(testEndpointAccess(['documents:manage'], school1Admin)).toBe(true);
    });

    it('Staff with Document Management can access documents:manage but is denied user/school/audit/metrics admin', () => {
      expect(testEndpointAccess(['documents:manage'], staffDocManager)).toBe(true);
      expect(testEndpointAccess(['spaces:read'], staffDocManager)).toBe(true);
      expect(testEndpointAccess(['documents:create'], staffDocManager)).toBe(true);
      // Denied admin endpoints
      expect(testEndpointAccess(['users:read'], staffDocManager)).toBe(false);
      expect(testEndpointAccess(['schools:create'], staffDocManager)).toBe(false);
      expect(testEndpointAccess(['audit:read'], staffDocManager)).toBe(false);
      expect(testEndpointAccess(['metrics:view'], staffDocManager)).toBe(false);
    });

    it('Regular Staff is denied document management and admin endpoints', () => {
      expect(testEndpointAccess(['spaces:read'], regularStaff)).toBe(true);
      expect(testEndpointAccess(['documents:read'], regularStaff)).toBe(true);
      // Denied
      expect(testEndpointAccess(['documents:manage'], regularStaff)).toBe(false);
      expect(testEndpointAccess(['documents:create'], regularStaff)).toBe(false);
      expect(testEndpointAccess(['users:read'], regularStaff)).toBe(false);
      expect(testEndpointAccess(['audit:read'], regularStaff)).toBe(false);
      expect(testEndpointAccess(['metrics:view'], regularStaff)).toBe(false);
    });

    it('Student is denied all management endpoints', () => {
      expect(testEndpointAccess(['documents:read'], studentUser)).toBe(true);
      // Denied
      expect(testEndpointAccess(['spaces:read'], studentUser)).toBe(false);
      expect(testEndpointAccess(['documents:manage'], studentUser)).toBe(false);
      expect(testEndpointAccess(['users:read'], studentUser)).toBe(false);
      expect(testEndpointAccess(['schools:read'], studentUser)).toBe(false);
      expect(testEndpointAccess(['groups:read'], studentUser)).toBe(false);
      expect(testEndpointAccess(['audit:read'], studentUser)).toBe(false);
      expect(testEndpointAccess(['metrics:view'], studentUser)).toBe(false);
    });
  });

  describe('Service-Level School Scoping Across Portal Endpoints', () => {
    describe('Users Endpoint Scoping (IdentityAndAccessService)', () => {
      it('scopes user list to caller school at query level', async () => {
        const mockPrisma = {
          user: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]) },
        };
        const service = new IdentityAndAccessService(
          mockPrisma as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
        );

        await service.listUsers(school1Admin, { page: 1, limit: 10 });
        expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              AND: [
                { assignments: { some: { schoolId: { in: ['school-1'] } } } },
              ],
            },
          }),
        );
      });

      it('throws 403 Forbidden when school admin queries user list for another school', async () => {
        const mockPrisma = {
          user: { count: vi.fn(), findMany: vi.fn() },
        };
        const service = new IdentityAndAccessService(
          mockPrisma as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
        );

        await expect(
          service.listUsers(school1Admin, { schoolId: 'school-2' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('throws 403 Forbidden when school admin views user detail belonging to another school', async () => {
        const mockPrisma = {
          user: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'user-foreign',
              email: 'foreign@school2.edu',
              fullName: 'Foreign User',
              status: 'ACTIVE',
              assignments: [], // Empty because query filtered where: { schoolId: { in: ['school-1'] } }
              groupMemberships: [],
            }),
          },
        };
        const service = new IdentityAndAccessService(
          mockPrisma as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
        );

        await expect(
          service.getUserDetail('user-foreign', school1Admin),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });
    });

    describe('Schools Endpoint Scoping (IdentityAndAccessService)', () => {
      it('scopes school list to caller school filter at database level', async () => {
        const mockPrisma = {
          school: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]) },
        };
        const service = new IdentityAndAccessService(
          mockPrisma as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
        );

        await service.findAllSchools(school1Admin);
        expect(mockPrisma.school.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: { in: ['school-1'] } },
          }),
        );
      });

      it('allows platform admin to list all schools without filtering', async () => {
        const mockPrisma = {
          school: { count: vi.fn().mockResolvedValue(2), findMany: vi.fn().mockResolvedValue([]) },
        };
        const service = new IdentityAndAccessService(
          mockPrisma as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
        );

        await service.findAllSchools(platformAdmin);
        expect(mockPrisma.school.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {},
          }),
        );
      });

      it('throws 403 Forbidden when school admin views another school by ID', async () => {
        const mockPrisma = { school: { findUnique: vi.fn() } };
        const service = new IdentityAndAccessService(
          mockPrisma as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
        );

        await expect(
          service.findSchoolById('school-2', school1Admin),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(mockPrisma.school.findUnique).not.toHaveBeenCalled();
      });
    });

    describe('Spaces and Documents Scoping (DocumentsService)', () => {
      it('scopes findAllSpaces to caller school at query level', async () => {
        const mockPrisma = {
          space: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]) },
        };
        const service = new DocumentsService(
          mockPrisma as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
        );

        await service.findAllSpaces(school1Admin);
        expect(mockPrisma.space.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { schoolId: { in: ['school-1'] } },
          }),
        );
      });

      it('throws 403 Forbidden when school admin or doc manager accesses space of another school', async () => {
        const mockPrisma = {
          space: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'space-s2',
              schoolId: 'school-2',
              name: 'School 2 Space',
              privacy: 'public',
            }),
          },
        };
        const service = new DocumentsService(
          mockPrisma as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
        );

        await expect(
          service.findSpaceById('space-s2', school1Admin),
        ).rejects.toBeInstanceOf(ForbiddenException);

        await expect(
          service.findSpaceById('space-s2', staffDocManager),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('allows platform admin to access space belonging to any school', async () => {
        const mockPrisma = {
          space: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'space-s2',
              schoolId: 'school-2',
              name: 'School 2 Space',
              privacy: 'public',
              school: { id: 'school-2', name: 'School Two' },
            }),
          },
        };
        const service = new DocumentsService(
          mockPrisma as any,
          {} as any,
          {} as any,
          {} as any,
          {} as any,
        );

        const space = await service.findSpaceById('space-s2', platformAdmin);
        expect(space.id).toBe('space-s2');
        expect(space.schoolId).toBe('school-2');
      });
    });

    describe('Groups Scoping (GroupsService)', () => {
      it('scopes group listing to caller school at query level', async () => {
        const mockPrisma = {
          group: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
        };
        const service = new GroupsService(mockPrisma as any);

        await service.listGroups(school1Admin);
        expect(mockPrisma.group.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ schoolId: { in: ['school-1'] } }),
          }),
        );
      });

      it('throws 403 Forbidden when school admin queries another school group', async () => {
        const foreignGroup = {
          id: 'group-s2',
          schoolId: 'school-2',
          name: 'Foreign Group',
          type: 'class',
          school: { name: 'School Two', status: 'active' },
          _count: { members: 0 },
        };
        const mockPrisma = {
          group: {
            findUnique: vi.fn().mockResolvedValue(foreignGroup),
            findFirst: vi.fn().mockResolvedValue(foreignGroup),
          },
        };
        const service = new GroupsService(mockPrisma as any);

        await expect(
          service.getGroup('group-s2', school1Admin),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });
    });

    describe('Audit Log Scoping (AuditQueryService)', () => {
      it('scopes audit events to caller school at query level', async () => {
        const mockPrisma = {
          auditEvent: { findMany: vi.fn().mockResolvedValue([]) },
        };
        const service = new AuditQueryService(mockPrisma as any);

        await service.findAll({}, school1Admin);
        expect(mockPrisma.auditEvent.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { schoolId: { in: ['school-1'] } },
          }),
        );
      });

      it('allows platform admin to view audit events with no school filter (including platform events)', async () => {
        const mockPrisma = {
          auditEvent: { findMany: vi.fn().mockResolvedValue([]) },
        };
        const service = new AuditQueryService(mockPrisma as any);

        await service.findAll({}, platformAdmin);
        expect(mockPrisma.auditEvent.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {},
          }),
        );
      });
    });

    describe('RAG Metrics Scoping (RagPerformanceService)', () => {
      it('allows school admin to view metrics for their own school', async () => {
        const service = new RagPerformanceService({} as any);
        const metrics = await service.findAllMetrics({ schoolId: 'school-1' }, school1Admin);
        expect(metrics).toHaveLength(1);
      });

      it('throws 403 Forbidden when school admin queries metrics for another school', async () => {
        const service = new RagPerformanceService({} as any);
        await expect(
          service.findAllMetrics({ schoolId: 'school-2' }, school1Admin),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('allows platform admin to query metrics for any school', async () => {
        const service = new RagPerformanceService({} as any);
        const metrics = await service.findAllMetrics({ schoolId: 'school-2' }, platformAdmin);
        expect(metrics).toHaveLength(1);
      });
    });
  });
});
