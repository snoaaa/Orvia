import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { SchoolsController } from './schools.controller.js';
import type { IdentityAndAccessService } from '../services/identity-and-access.service.js';
import { SchoolEntity } from '../entities/index.js';

describe('SchoolsController (Issue #27)', () => {
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
        permissions: ['schools:create', 'schools:read'],
      },
    ],
    permissions: ['schools:create', 'schools:read'],
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
});
