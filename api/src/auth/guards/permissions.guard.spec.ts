import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionsGuard } from './permissions.guard.js';
import { IS_PUBLIC_KEY, REQUIRED_PERMISSIONS_KEY } from '../decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

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

  it('allows access to public endpoints without checking permissions', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return true;
      return [];
    });

    const context = createMockContext();
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access when no permissions are required', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === REQUIRED_PERMISSIONS_KEY) return [];
      return undefined;
    });

    const context = createMockContext();
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access when user has the exact required permission', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === REQUIRED_PERMISSIONS_KEY) return ['documents:read'];
      return undefined;
    });

    const context = createMockContext({
      permissions: ['documents:read'],
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access when user holds documents:manage and endpoint requires documents:manage (#88)', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === REQUIRED_PERMISSIONS_KEY) return ['documents:manage'];
      return undefined;
    });

    const context = createMockContext({
      permissions: ['documents:manage'],
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access when user holds documents:manage and endpoint requires documents:create (#88)', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === REQUIRED_PERMISSIONS_KEY) return ['documents:create'];
      return undefined;
    });

    const context = createMockContext({
      permissions: ['documents:manage'],
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access when user holds documents.manage alias (#88)', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === REQUIRED_PERMISSIONS_KEY) return ['documents:manage'];
      return undefined;
    });

    const context = createMockContext({
      permissions: ['documents.manage'],
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies access (throws 403) when user lacks documents:manage (#88)', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === REQUIRED_PERMISSIONS_KEY) return ['documents:manage'];
      return undefined;
    });

    const context = createMockContext({
      permissions: ['documents:read'],
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows wildcard permissions', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === REQUIRED_PERMISSIONS_KEY) return ['system:manage'];
      return undefined;
    });

    const context = createMockContext({
      permissions: ['*'],
    });
    expect(guard.canActivate(context)).toBe(true);
  });
});

