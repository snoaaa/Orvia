import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  extractAccessContext,
  IS_PUBLIC_KEY,
  Public,
  REQUIRED_ANY_PERMISSION_KEY,
  REQUIRED_PERMISSIONS_KEY,
  REQUIRED_ROLES_KEY,
  RequireAnyPermission,
  RequirePermission,
  RequireRole,
} from './auth.decorators.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

describe('Auth Decorators and AccessContext (#89)', () => {
  it('extractAccessContext correctly forms AccessContext from AuthenticatedUser', () => {
    const user: AuthenticatedUser = {
      id: 'usr-123',
      email: 'teacher@school.edu',
      fullName: 'Teacher Jane',
      status: 'ACTIVE',
      roles: ['STAFF'],
      role: 'STAFF',
      permissions: ['documents:create', 'documents:read'],
      schoolIds: ['school-1'],
      isPlatformAdmin: false,
      sessionId: 'sess-1',
      assignments: [
        {
          role: 'STAFF',
          scope: 'school',
          schoolId: 'school-1',
          schoolStatus: 'active',
          groupId: null,
          permissions: ['documents:create', 'documents:read'],
        },
      ],
    };

    const ctx = extractAccessContext(user);
    expect(ctx).toEqual({
      userId: 'usr-123',
      email: 'teacher@school.edu',
      fullName: 'Teacher Jane',
      roles: ['STAFF'],
      permissions: ['documents:create', 'documents:read'],
      schoolIds: ['school-1'],
      isPlatformAdmin: false,
      assignments: user.assignments,
    });
  });

  it('extractAccessContext falls back to single role if roles array is undefined', () => {
    const user = {
      id: 'usr-456',
      email: 'admin@platform.internal',
      fullName: 'Root Admin',
      status: 'ACTIVE',
      role: 'PLATFORM_ADMIN',
      permissions: ['*'],
      schoolIds: [],
      isPlatformAdmin: true,
      sessionId: 'sess-2',
      assignments: [],
    } as unknown as AuthenticatedUser;

    const ctx = extractAccessContext(user);
    expect(ctx.roles).toEqual(['PLATFORM_ADMIN']);
    expect(ctx.isPlatformAdmin).toBe(true);
  });

  it('extractAccessContext throws UnauthorizedException if user is missing', () => {
    expect(() => extractAccessContext(undefined)).toThrow(UnauthorizedException);
  });

  it('RequirePermission sets REQUIRED_PERMISSIONS_KEY metadata', () => {
    class TestController {
      @RequirePermission('documents:create', 'documents:read')
      testMethod(this: void) {}
    }

    const metadata = Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, TestController.prototype.testMethod);
    expect(metadata).toEqual(['documents:create', 'documents:read']);
  });

  it('RequireAnyPermission sets REQUIRED_ANY_PERMISSION_KEY metadata', () => {
    class TestController {
      @RequireAnyPermission('spaces:read', 'documents:read')
      testMethod(this: void) {}
    }

    const metadata = Reflect.getMetadata(REQUIRED_ANY_PERMISSION_KEY, TestController.prototype.testMethod);
    expect(metadata).toEqual(['spaces:read', 'documents:read']);
  });

  it('RequireRole sets REQUIRED_ROLES_KEY metadata', () => {
    class TestController {
      @RequireRole('PLATFORM_ADMIN', 'SCHOOL_ADMIN')
      testMethod(this: void) {}
    }

    const metadata = Reflect.getMetadata(REQUIRED_ROLES_KEY, TestController.prototype.testMethod);
    expect(metadata).toEqual(['PLATFORM_ADMIN', 'SCHOOL_ADMIN']);
  });

  it('Public sets IS_PUBLIC_KEY metadata', () => {
    class TestController {
      @Public()
      testMethod(this: void) {}
    }

    const metadata = Reflect.getMetadata(IS_PUBLIC_KEY, TestController.prototype.testMethod);
    expect(metadata).toBe(true);
  });
});
