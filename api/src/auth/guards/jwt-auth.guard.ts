import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/auth.decorators.js';
import { AuthUserService } from '../services/auth-user.service.js';
import { SessionService } from '../services/session.service.js';
import { TokenService } from '../services/token.service.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

/**
 * Global guard (registered in AuthModule). Every route needs a valid `Authorization: Bearer`
 * access token unless it is marked @Public():
 *  - no / malformed / forged / expired token, unknown user,
 *    or its session logged out / revoked / expired (#12)        -> 401
 *  - user SUSPENDED, or not yet ACTIVE (still INVITED)          -> 403
 * On success, request.user is the AuthenticatedUser freshly loaded from the database.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly users: AuthUserService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = extractBearerToken(request);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    const payload = await this.tokens.verifyAccessToken(token);
    if (!payload) throw new UnauthorizedException('Invalid or expired token');
    // Logout and revocation take effect immediately, not when the access token expires.
    if (payload.sid && !(await this.sessions.isActive(payload.sid))) {
      throw new UnauthorizedException('Session has ended');
    }

    const user = await this.users.load(payload.sub, payload.sid ?? null);
    if (!user) throw new UnauthorizedException('Invalid or expired token');

    // Attach before the status checks so a refused 403 still knows who was refused.
    request.user = user;
    if (user.status === 'SUSPENDED') throw new ForbiddenException('Account suspended');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Account not activated');

    return true;
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.header('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token.trim() : null;
}
