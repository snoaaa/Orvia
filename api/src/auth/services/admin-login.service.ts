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
 *  - Timing-safe: bcrypt.compare always runs, even when the email doesn't exist,
 *    to prevent user-enumeration via response-time differences.
 *  - INVITED accounts transition to ACTIVE on first successful login.
 *  - All failures and successes are audited.
 *
 * Note: domain restrictions (Issue #11) do NOT apply to admin accounts.
 */
@Injectable()
export class AdminLoginService {
  private readonly logger = new Logger(AdminLoginService.name);

  /**
   * Pre-computed bcrypt hash used as a dummy comparison target when the user does
   * not exist or is not a password-based account. This ensures bcrypt.compare always
   * runs and the response time does not reveal whether an email is registered.
   * (Cost factor 10 matches the minimum we accept for real hashes.)
   */
  private static readonly DUMMY_HASH =
    '$2b$10$D92KgaVpmdy2b87Os1Yr6um6TTYmihCn145pcNbE7eQASgOD7M5vK';

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

    // Determine which hash to compare against. When the user doesn't exist or is
    // not a local-auth account, we use a dummy hash so bcrypt.compare() always
    // runs and the response time cannot be used to enumerate valid emails.
    const isPasswordAccount = !!user && user.authProvider === 'local' && !!user.passwordHash;
    const hashToCompare = isPasswordAccount ? user.passwordHash! : AdminLoginService.DUMMY_HASH;

    // Always run bcrypt compare — even for non-existent/non-password users.
    const passwordValid = await bcrypt.compare(password, hashToCompare);

    // Reject if user not found, not a password account, or wrong password.
    if (!user || !isPasswordAccount || !passwordValid) {
      await this.recordFailure(normalizedEmail, 'invalid_credentials', user?.id ?? null, context);
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

    // Case 6: INVITED status — transition to ACTIVE on first successful login.
    // Without this, the JWT guard (which requires status === 'ACTIVE') would reject
    // every subsequent authenticated request the user makes after logging in.
    if (user.status === 'INVITED') {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE' },
      });
      this.logger.log(`Admin account ${user.email} transitioned from INVITED to ACTIVE on first login`);
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
