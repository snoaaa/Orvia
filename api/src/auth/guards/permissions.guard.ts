import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY, REQUIRED_PERMISSIONS_KEY } from '../decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

const DOC_MANAGE_PERMISSIONS = new Set([
  'documents:manage',
  'documents.manage',
]);

const DOC_COVERED_PERMISSIONS = new Set([
  'documents:create',
  'documents:update',
  'documents:delete',
  'documents:publish',
  'documents:manage_access',
  'documents:process',
  'documents:access.manage',
  'documents.access.manage',
  'spaces:create',
  'spaces:update',
  'spaces:delete',
  'spaces:manage',
  'documents:manage',
  'documents.manage',
]);

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
    const userPerms = user?.permissions ?? [];

    const hasWildcard = userPerms.includes('*');
    const hasDocManage = userPerms.some((p) => DOC_MANAGE_PERMISSIONS.has(p));

    const missing = required.filter((reqPerm) => {
      if (hasWildcard) return false;
      if (userPerms.includes(reqPerm)) return false;
      if (DOC_MANAGE_PERMISSIONS.has(reqPerm) && (hasDocManage || userPerms.some((p) => DOC_COVERED_PERMISSIONS.has(p)))) return false;
      if (DOC_COVERED_PERMISSIONS.has(reqPerm) && hasDocManage) return false;
      return true;
    });

    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    }
    return true;
  }
}
