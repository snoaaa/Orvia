import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const REQUIRED_PERMISSIONS_KEY = 'auth:requiredPermissions';

/** Opens a route (or a whole controller) to requests without a token: login, refresh, health. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * The user needs ALL listed permissions (codes from the seed, e.g. 'users:invite').
 * Without it the request gets 403. School scoping is checked separately in the service,
 * because it depends on the data being accessed.
 */
export const RequirePermission = (...permissions: string[]) => SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/** Injects the authenticated user (see AuthenticatedUser) into a controller method. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
  return request.user as AuthenticatedUser;
});
