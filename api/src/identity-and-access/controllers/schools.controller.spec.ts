import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { SchoolsController } from './schools.controller.js';
import type { IdentityAndAccessService } from '../services/identity-and-access.service.js';
import { PaginatedSchoolsEntity, SchoolEntity } from '../entities/index.js';

describe('SchoolsController (Issue #27, #29, #30)', () => {
  const platformAdmin: AuthenticatedUser = {
    id: 'platform-admin-id',
    email: 'admin@wamdp.platform',
    fullName: 'Platform Admin',
    status: 'ACTIVE',
    assignments: [
      {
        role: 'PLATFORM_ADMIN',
        scope: 'platform',
        schoolId: '00000000-0000-0000-0000-000000000001',
        groupId: null,
        permissions: ['schools:create', 'schools:read', 'schools:update', 'schools:delete'],
      },
    ],
    permissions: ['schools:create', 'schools:read', 'schools:update', 'schools:delete'],
    schoolIds: ['00000000-0000-0000-0000-000000000001'],
    isPlatformAdmin: true,
    role: 'PLATFORM_ADMIN',
    schoolId: '00000000-0000-0000-0000-000000000001',
    sessionId: null,
  };

  const fakeReq = {
    ip: '127.0.0.1',
    header: vi.fn((name: string) => (name.toLowerCase() === 'user-agent' ? 'vitest-agent' : undefined)),
    headers: { 'user-agent': 'vitest-agent' },
  } as unknown as Request;

  it('delegates school creation to IdentityAndAccessService with actor and audit context', async () => {
    const mockCreated = new SchoolEntity({
      id: 'new-school-id',
      name: 'Polytechnic Engineering Institute',
      status: 'active',
      allowedDomains: '',
      settings: { maxUsers: 500 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const createSchoolMock = vi.fn().mockResolvedValue(mockCreated);
    const mockIdentityService = {
      createSchool: createSchoolMock,
    } as unknown as IdentityAndAccessService;

    const controller = new SchoolsController(mockIdentityService);
    const dto = {
      name: 'Polytechnic Engineering Institute',
      settings: { maxUsers: 500 },
      status: 'active',
    };

    const result = await controller.createSchool(dto, platformAdmin, fakeReq);

    expect(createSchoolMock).toHaveBeenCalledWith(
      dto,
      platformAdmin,
      expect.objectContaining({
        ip: '127.0.0.1',
        userAgent: 'vitest-agent',
      }),
    );
    expect(result).toBe(mockCreated);
    expect(result.status).toBe('active');
  });

  it('delegates paginated school listing to IdentityAndAccessService', async () => {
    const mockPaginated = new PaginatedSchoolsEntity({
      data: [
        new SchoolEntity({
          id: 'school-1',
          name: 'School 1',
          status: 'active',
          allowedDomains: '',
          settings: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
    });

    const findAllSchoolsMock = vi.fn().mockResolvedValue(mockPaginated);
    const mockIdentityService = {
      findAllSchools: findAllSchoolsMock,
    } as unknown as IdentityAndAccessService;

    const controller = new SchoolsController(mockIdentityService);
    const query = { page: 1, limit: 10, status: 'active', search: 'School' };

    const result = await controller.getSchools(query, platformAdmin);

    expect(findAllSchoolsMock).toHaveBeenCalledWith(platformAdmin, query);
    expect(result).toBe(mockPaginated);
    expect(result.data.length).toBe(1);
    expect(result.total).toBe(1);
  });

  it('delegates viewing single school by ID to IdentityAndAccessService', async () => {
    const mockSchool = new SchoolEntity({
      id: '00000000-0000-0000-0000-000000000001',
      name: 'WAMDP Platform Administration',
      status: 'active',
      allowedDomains: '',
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const findSchoolByIdMock = vi.fn().mockResolvedValue(mockSchool);
    const mockIdentityService = {
      findSchoolById: findSchoolByIdMock,
    } as unknown as IdentityAndAccessService;

    const controller = new SchoolsController(mockIdentityService);
    const schoolId = '00000000-0000-0000-0000-000000000001';

    const result = await controller.getSchoolById(schoolId, platformAdmin);

    expect(findSchoolByIdMock).toHaveBeenCalledWith(schoolId, platformAdmin);
    expect(result).toBe(mockSchool);
    expect(result.id).toBe(schoolId);
  });

  it('delegates updating school to IdentityAndAccessService with actor and audit context', async () => {
    const mockUpdated = new SchoolEntity({
      id: '00000000-0000-0000-0000-000000000001',
      name: 'WAMDP Platform Administration (Updated)',
      status: 'active',
      allowedDomains: '',
      settings: { maxUsers: 2000 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const updateSchoolMock = vi.fn().mockResolvedValue(mockUpdated);
    const mockIdentityService = {
      updateSchool: updateSchoolMock,
    } as unknown as IdentityAndAccessService;

    const controller = new SchoolsController(mockIdentityService);
    const schoolId = '00000000-0000-0000-0000-000000000001';
    const dto = {
      name: 'WAMDP Platform Administration (Updated)',
      settings: { maxUsers: 2000 },
    };

    const result = await controller.updateSchool(schoolId, dto, platformAdmin, fakeReq);

    expect(updateSchoolMock).toHaveBeenCalledWith(
      schoolId,
      dto,
      platformAdmin,
      expect.objectContaining({
        ip: '127.0.0.1',
        userAgent: 'vitest-agent',
      }),
    );
    expect(result).toBe(mockUpdated);
    expect(result.name).toBe('WAMDP Platform Administration (Updated)');
  });

  it('delegates school deactivation to IdentityAndAccessService with actor and audit context', async () => {
    const mockDeactivated = new SchoolEntity({
      id: '00000000-0000-0000-0000-000000000001',
      name: 'WAMDP Platform Administration',
      status: 'deactivated',
      allowedDomains: '',
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const deactivateSchoolMock = vi.fn().mockResolvedValue(mockDeactivated);
    const mockIdentityService = {
      deactivateSchool: deactivateSchoolMock,
    } as unknown as IdentityAndAccessService;

    const controller = new SchoolsController(mockIdentityService);
    const schoolId = '00000000-0000-0000-0000-000000000001';

    const result = await controller.deactivateSchool(schoolId, platformAdmin, fakeReq);

    expect(deactivateSchoolMock).toHaveBeenCalledWith(
      schoolId,
      platformAdmin,
      expect.objectContaining({
        ip: '127.0.0.1',
        userAgent: 'vitest-agent',
      }),
    );
    expect(result).toBe(mockDeactivated);
    expect(result.status).toBe('deactivated');
  });

  it('delegates school reactivation to IdentityAndAccessService with actor and audit context', async () => {
    const mockReactivated = new SchoolEntity({
      id: '00000000-0000-0000-0000-000000000001',
      name: 'WAMDP Platform Administration',
      status: 'active',
      allowedDomains: '',
      settings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const reactivateSchoolMock = vi.fn().mockResolvedValue(mockReactivated);
    const mockIdentityService = {
      reactivateSchool: reactivateSchoolMock,
    } as unknown as IdentityAndAccessService;

    const controller = new SchoolsController(mockIdentityService);
    const schoolId = '00000000-0000-0000-0000-000000000001';

    const result = await controller.reactivateSchool(schoolId, platformAdmin, fakeReq);

    expect(reactivateSchoolMock).toHaveBeenCalledWith(
      schoolId,
      platformAdmin,
      expect.objectContaining({
        ip: '127.0.0.1',
        userAgent: 'vitest-agent',
      }),
    );
    expect(result).toBe(mockReactivated);
    expect(result.status).toBe('active');
  });
});
