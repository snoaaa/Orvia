import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser, AuthRoleAssignment } from '../types/authenticated-user.js';
import { assertSchoolAccess, canInSchool, schoolIdFilter, schoolsWithPermission } from './school-scope.util.js';

function userWith(...assignments: AuthRoleAssignment[]): AuthenticatedUser {
  return {
    id: 'u1',
    email: 'u1@school.edu',
    fullName: 'U1',
    status: 'ACTIVE',
    assignments,
    permissions: [...new Set(assignments.flatMap((a) => a.permissions))],
    schoolIds: assignments.map((a) => a.schoolId),
    isPlatformAdmin: assignments.some((a) => a.scope === 'platform'),
    role: assignments[0]?.role ?? null,
    schoolId: assignments[0]?.schoolId ?? null,
    sessionId: null,
  };
}

const platformAdmin = userWith({ role: 'PLATFORM_ADMIN', scope: 'platform', schoolId: 'sys', groupId: null, permissions: ['users:read'] });
const adminA = userWith({ role: 'SCHOOL_ADMIN', scope: 'school', schoolId: 'A', groupId: null, permissions: ['users:read', 'users:invite'] });
const mixed = userWith(
  { role: 'SCHOOL_ADMIN', scope: 'school', schoolId: 'A', groupId: null, permissions: ['users:read'] },
  { role: 'STUDENT', scope: 'group', schoolId: 'B', groupId: 'g', permissions: ['rag:query'] },
);

describe('school scope', () => {
  it('gives platform roles every school', () => {
    expect(schoolsWithPermission(platformAdmin, 'users:read')).toBe('all');
    expect(schoolIdFilter(platformAdmin, 'users:read')).toBeUndefined();
    expect(() => assertSchoolAccess(platformAdmin, 'users:read', [])).not.toThrow();
  });

  it('limits school roles to their schools', () => {
    expect(schoolsWithPermission(adminA, 'users:read')).toEqual(['A']);
    expect(schoolIdFilter(adminA, 'users:read')).toEqual({ in: ['A'] });
    expect(canInSchool(adminA, 'users:read', 'A')).toBe(true);
    expect(canInSchool(adminA, 'users:read', 'B')).toBe(false);
  });

  it('checks the permission per school, not globally', () => {
    // users:read comes from the SCHOOL_ADMIN role in A only, not from the STUDENT role in B.
    expect(canInSchool(mixed, 'users:read', 'B')).toBe(false);
    expect(canInSchool(mixed, 'rag:query', 'B')).toBe(true);
    expect(canInSchool(mixed, 'rag:query', 'A')).toBe(false);
  });

  it('throws 403 outside the scope', () => {
    expect(() => assertSchoolAccess(adminA, 'users:read', 'B')).toThrow(ForbiddenException);
    expect(() => assertSchoolAccess(adminA, 'users:read', [])).toThrow(ForbiddenException);
    expect(() => assertSchoolAccess(adminA, 'users:read', ['B', 'A'])).not.toThrow();
  });

  describe('documents:manage permission scoping (#88)', () => {
    const staffWithDocManage = userWith({
      role: 'CONTENT_MANAGER',
      scope: 'school',
      schoolId: 'A',
      groupId: null,
      permissions: ['documents:manage'],
    });

    const staffWithoutDocManage = userWith({
      role: 'STAFF',
      scope: 'school',
      schoolId: 'A',
      groupId: null,
      permissions: ['spaces:read', 'documents:read'],
    });

    it('allows staff with documents:manage to manage documents and spaces in their school', () => {
      expect(canInSchool(staffWithDocManage, 'documents:manage', 'A')).toBe(true);
      expect(canInSchool(staffWithDocManage, 'documents:create', 'A')).toBe(true);
      expect(canInSchool(staffWithDocManage, 'documents:update', 'A')).toBe(true);
      expect(canInSchool(staffWithDocManage, 'documents:delete', 'A')).toBe(true);
      expect(canInSchool(staffWithDocManage, 'spaces:create', 'A')).toBe(true);
      expect(() => assertSchoolAccess(staffWithDocManage, 'documents:manage', 'A')).not.toThrow();
    });

    it('denies staff with documents:manage in School A on School B spaces/documents (403)', () => {
      expect(canInSchool(staffWithDocManage, 'documents:manage', 'B')).toBe(false);
      expect(() => assertSchoolAccess(staffWithDocManage, 'documents:manage', 'B')).toThrow(ForbiddenException);
    });

    it('denies staff without documents:manage on all management endpoints (403)', () => {
      expect(canInSchool(staffWithoutDocManage, 'documents:manage', 'A')).toBe(false);
      expect(() => assertSchoolAccess(staffWithoutDocManage, 'documents:manage', 'A')).toThrow(ForbiddenException);
    });
  });
});
