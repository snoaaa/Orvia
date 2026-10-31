import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AuditEvents } from '../../audit/builders/audit-events.builder.js';
import { AuditService } from '../../audit/services/audit.service.js';
import type { AuditRequestContext } from '../../audit/utils/audit-request-context.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import { SessionService, type TokenPair } from './session.service.js';

/**
 * Precomputed 12-round bcrypt hash for dummy password comparison.
 * Neutralizes user enumeration timing attacks by guaranteeing constant-time comparison
 * even when the email is unregistered or the account has no password.
 */
const DUMMY_BCRYPT_HASH =
  '$2b$12$jyA712IBNf0Scv9Aiikzh.17fk30r55zowTVjt83wnnupx/gFTRA.';

/**
 * Handles administrator authentication via email + password (Issue #8).
 *
 * Enforces:
 *  - Constant-time execution (dummy bcrypt comparison) to prevent timing side-channels.
 *  - Local password-only accounts (`authProvider === 'local'` and `passwordHash !== null`).
 *  - Generic 401 on credential mismatch, suspended status, or non-admin accounts.
 *  - Admin role requirement: platform-scoped role or `SCHOOL_ADMIN`.
 *  - First-login activation: transitions `INVITED` admin accounts to `ACTIVE` so subsequent
 *    requests pass `JwtAuthGuard` without lockout.
 *  - Stateful session creation with rotating refresh token in `sessions` table.
 *  - Hash-chained audit logging for all authentication attempts (`login_success` / `login_failure`).
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
   * Validates administrator credentials and initiates an authenticated session.
   *
   * @param email Administrator email
   * @param password Plaintext password
   * @param context Request audit context (IP, user agent)
   * @param deviceId Optional registered device UUID
   * @returns Newly generated TokenPair with access and refresh tokens
   * @throws UnauthorizedException with generic "Invalid credentials" on any authentication failure
   */
  async login(
    email: string,
    password: string,
    context: AuditRequestContext,
    deviceId?: string,
  ): Promise<TokenPair> {
    const normalizedEmail = (email || '').trim().toLowerCase();

    // 1. Fetch user together with role assignments
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

    // 2. Case: User not found or account is not password-based (e.g. Google-only).
    // Perform dummy bcrypt comparison to ensure uniform response timing.
    if (!user || user.authProvider !== 'local' || !user.passwordHash) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      await this.recordFailure(
        normalizedEmail,
        'invalid_credentials',
        user?.id ?? null,
        context,
      );
      return this.deny();
    }

    // 3. Case: Password mismatch
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      await this.recordFailure(
        normalizedEmail,
        'invalid_credentials',
        user.id,
        context,
      );
      return this.deny();
    }

    // 4. Case: Account suspended -> generic 401 (audited as account_suspended)
    if (user.status === 'SUSPENDED') {
      await this.recordFailure(
        normalizedEmail,
        'account_suspended',
        user.id,
        context,
      );
      return this.deny();
    }

    // 5. Case: Account is not an administrator (neither platform scope nor SCHOOL_ADMIN)
    const isAdmin = user.assignments.some(
      (a) => a.role.scope === 'platform' || a.role.name === 'SCHOOL_ADMIN',
    );
    if (!isAdmin) {
      await this.recordFailure(normalizedEmail, 'not_admin', user.id, context);
      return this.deny();
    }

    // 6. First-login activation: transition INVITED admin accounts to ACTIVE
    if (user.status === 'INVITED') {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE' },
      });
      user.status = 'ACTIVE';
    }

    // 7. Create stateful session with hashed refresh token rotation
    const effectiveDeviceId = deviceId ?? context.deviceId ?? null;
    const pair = await this.sessions.createSession(user.id, context, effectiveDeviceId);

    // 8. Resolve primary admin assignment for audit trail
    const adminAssignment =
      user.assignments.find((a) => a.role.scope === 'platform') ||
      user.assignments.find((a) => a.role.name === 'SCHOOL_ADMIN') ||
      user.assignments[0];

    await this.audit.record(
      AuditEvents.loginSuccess(
        {
          userId: user.id,
          role: adminAssignment?.role.name ?? null,
          schoolId: adminAssignment?.schoolId ?? null,
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
        AuditEvents.loginFailure(
          { email, reason, method: 'password', userId },
          context,
        ),
      );
    } catch (err) {
      this.logger.error(
        'Failed to audit login failure',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  /** Throws a uniform generic 401 without exposing enumeration cues. */
  private deny(): never {
    throw new UnauthorizedException('Invalid credentials');
  }
}
