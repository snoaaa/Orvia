import { createParamDecorator, ExecutionContext, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { AccessContext, AuthenticatedUser } from '../types/authenticated-user.js';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const REQUIRED_PERMISSIONS_KEY = 'auth:requiredPermissions';
export const REQUIRED_ANY_PERMISSION_KEY = 'auth:requiredAnyPermission';
export const REQUIRED_ROLES_KEY = 'auth:requiredRoles';

/** Opens a route (or a whole controller) to requests without a token: login, refresh, health. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * The user needs ALL listed permissions (codes from the seed, e.g. 'users:invite').
 * Without it the request gets 403. School scoping is checked separately in the service,
 * because it depends on the data being accessed.
 */
export const RequirePermission = (...permissions: string[]) => SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/**
 * The user needs AT LEAST ONE of the listed permissions.
 */
export const RequireAnyPermission = (...permissions: string[]) => SetMetadata(REQUIRED_ANY_PERMISSION_KEY, permissions);

/**
 * The user must hold AT LEAST ONE of the listed roles (e.g. 'PLATFORM_ADMIN', 'SCHOOL_ADMIN').
 */
export const RequireRole = (...roles: string[]) => SetMetadata(REQUIRED_ROLES_KEY, roles);

/** Injects the authenticated user (see AuthenticatedUser) into a controller method. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
  return request.user as AuthenticatedUser;
});

/**
 * Pure extractor for request-scoped AccessContext (§4.5, §4.7, #89).
 */
export function extractAccessContext(user?: AuthenticatedUser): AccessContext {
  if (!user) {
    throw new UnauthorizedException('Missing authentication context');
  }
  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    roles: user.roles ?? (user.role ? [user.role] : []),
    permissions: user.permissions,
    schoolIds: user.schoolIds,
    isPlatformAdmin: user.isPlatformAdmin,
    assignments: user.assignments,
  };
}

/**
 * Injects the request-scoped access context (§4.5, §4.7, #89):
 * userId, roles, permissions, schoolIds, isPlatformAdmin, assignments.
 */
export const CurrentAccessContext = createParamDecorator((_data: unknown, ctx: ExecutionContext): AccessContext => {
  const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
  return extractAccessContext(request.user);
});
