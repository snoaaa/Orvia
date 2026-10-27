import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AuditEvents } from '../../audit/builders/audit-events.builder.js';
import { AuditService } from '../../audit/services/audit.service.js';
import type { AuditRequestContext } from '../../audit/utils/audit-request-context.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import { SessionService, type TokenPair } from './session.service.js';

/**
 * Handles admin email + password login (Issue #8).
 *
 * Security rules enforced here:
 *  - Only users whose `authProvider = 'local'` can log in with a password.
 *  - Only users with a platform-scoped or school-scoped admin role are allowed.
 *  - Suspended accounts → 401 with a generic error (no hint about suspension).
 *  - Wrong credentials → same generic 401 (no field-level hints for attackers).
 *  - All failures and successes are audited.
 *
 * Note: domain restrictions (Issue #11) do NOT apply to admin accounts.
 */
@Injectable()
export class AdminLoginService {
  private readonly logger = new Logger(AdminLoginService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Validates email + password and, on success, starts a session.
   *
   * @returns The new token pair (access + refresh) with the session id.
   * @throws UnauthorizedException with a generic message on any failure.
   */
  async login(email: string, password: string, context: AuditRequestContext): Promise<TokenPair> {
    const normalizedEmail = email.trim().toLowerCase();

    // Load the user together with their role assignments so we can check admin status.
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        assignments: {
          include: {
            role: { select: { name: true, scope: true } },
          },
        },
      },
    });

    // Case 1: user not found — same generic error as wrong password (no enumeration).
    if (!user) {
      await this.recordFailure(normalizedEmail, 'invalid_credentials', null, context);
      return this.deny();
    }

    // Case 2: account is not a local-auth (password) account.
    if (user.authProvider !== 'local' || !user.passwordHash) {
      await this.recordFailure(normalizedEmail, 'invalid_credentials', user.id, context);
      return this.deny();
    }

    // Case 3: password mismatch — constant-time comparison via bcrypt.
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      await this.recordFailure(normalizedEmail, 'invalid_credentials', user.id, context);
      return this.deny();
    }

    // Case 4: account suspended — still a generic error.
    if (user.status === 'SUSPENDED') {
      await this.recordFailure(normalizedEmail, 'account_suspended', user.id, context);
      return this.deny();
    }

    // Case 5: not an admin account (no platform or school admin role).
    const isAdmin = user.assignments.some(
      (a) => a.role.scope === 'platform' || a.role.name === 'SCHOOL_ADMIN',
    );
    if (!isAdmin) {
      await this.recordFailure(normalizedEmail, 'not_admin', user.id, context);
      return this.deny();
    }

    // All checks passed → create session.
    const pair = await this.sessions.createSession(user.id, context);

    const primaryAssignment = user.assignments[0];
    await this.audit.record(
      AuditEvents.loginSuccess(
        {
          userId: user.id,
          role: primaryAssignment?.role.name ?? null,
          schoolId: primaryAssignment?.schoolId ?? null,
          method: 'password',
          sessionId: pair.sessionId,
        },
        context,
      ),
    );

    return pair;
  }

  private async recordFailure(
    email: string,
    reason: 'invalid_credentials' | 'account_suspended' | 'not_admin',
    userId: string | null,
    context: AuditRequestContext,
  ): Promise<void> {
    try {
      await this.audit.record(
        AuditEvents.loginFailure({ email, reason, method: 'password', userId }, context),
      );
    } catch (err) {
      this.logger.error('Failed to audit login failure', err instanceof Error ? err.stack : err);
    }
  }

  /** Throws a generic 401 — never reveals the real reason to the caller. */
  private deny(): never {
    throw new UnauthorizedException('Invalid credentials');
  }
}
