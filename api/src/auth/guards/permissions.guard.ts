import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY, REQUIRED_PERMISSIONS_KEY } from '../decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

/**
 * Global guard, runs after JwtAuthGuard. Enforces @RequirePermission(): the user must hold
 * every listed permission through at least one of their roles, otherwise 403.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, targets);
    if (!required?.length) return true;

    const { user } = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const missing = required.filter((p) => !user?.permissions.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    }
    return true;
  }
}
