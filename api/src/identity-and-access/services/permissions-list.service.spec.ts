import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser, AuthRoleAssignment } from '../../auth/types/authenticated-user.js';
import { IdentityAndAccessService } from './identity-and-access.service.js';

/** GET /permissions: listPermissions(). */
describe('IdentityAndAccessService - list permissions', () => {
  const actorWith = (assignment: AuthRoleAssignment): AuthenticatedUser => ({
    id: 'actor',
    email: 'actor@school.edu',
    fullName: 'Actor',
    status: 'ACTIVE',
    assignments: [assignment],
    permissions: assignment.permissions,
    schoolIds: [assignment.schoolId],
    isPlatformAdmin: assignment.scope === 'platform',
    role: assignment.role,
    schoolId: assignment.schoolId,
    sessionId: null,
  });
  const serviceWith = (rows: { code: string; description: string | null }[]) =>
    new IdentityAndAccessService(
      { permission: { findMany: vi.fn().mockResolvedValue(rows) } } as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('returns code, description and category, sorted by category then code', async () => {
    const service = serviceWith([
      { code: 'users:read', description: 'View users' },
      { code: 'audit:read', description: null },
      { code: 'users:invite', description: 'Invite users' },
    ]);
    const admin = actorWith({ role: 'PLATFORM_ADMIN', scope: 'platform', schoolId: 'sys', groupId: null, permissions: ['system:manage'] });

    await expect(service.listPermissions(admin)).resolves.toEqual([
      { code: 'audit:read', description: null, category: 'audit' },
      { code: 'users:invite', description: 'Invite users', category: 'users' },
      { code: 'users:read', description: 'View users', category: 'users' },
    ]);
  });

  it('refuses a school-scoped role, even one holding system:manage', async () => {
    const service = serviceWith([]);
    const schoolRole = actorWith({ role: 'CUSTOM', scope: 'school', schoolId: 'A', groupId: null, permissions: ['system:manage'] });
    await expect(service.listPermissions(schoolRole)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
