import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import {
  AuditEvents,
  type LoginFailureReason,
} from '../../audit/builders/audit-events.builder.js';
import { AuditService } from '../../audit/services/audit.service.js';
import type { AuditRequestContext } from '../../audit/utils/audit-request-context.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import { SessionService, type TokenPair } from './session.service.js';

/**
 * Precomputed 12-round bcrypt hash for dummy password comparison.
 * Neutralizes user enumeration timing attacks by guaranteeing constant-time comparison
 * even when the email is unregistered, locked, or the account has no password.
 */
const DUMMY_BCRYPT_HASH =
  '$2b$12$jyA712IBNf0Scv9Aiikzh.17fk30r55zowTVjt83wnnupx/gFTRA.';

/**
 * Maximum consecutive failed login attempts before temporary account lockout.
 */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;

/**
 * Account lockout duration in milliseconds (15 minutes).
 */
export const ACCOUNT_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

interface FailedAttemptState {
  attempts: number;
  lastAttemptAt: number;
  lockedUntil?: Date | null;
}

/**
 * Handles administrator authentication via email + password (Issue #8).
 *
 * Enforces:
 *  - Constant-time execution (dummy bcrypt comparison) to prevent timing side-channels.
 *  - Local password-only accounts (`authProvider === 'local'` and `passwordHash !== null`).
 *  - Generic 401 on credential mismatch, suspended status, or non-admin accounts.
 *  - Admin role requirement: platform-scoped role or `SCHOOL_ADMIN`.
 *  - Brute-force mitigation: locks account after 5 consecutive failures and audits `account_locked`.
 *  - First-login activation: transitions `INVITED` admin accounts to `ACTIVE` so subsequent
 *    requests pass `JwtAuthGuard` without lockout.
 *  - Stateful session creation with rotating refresh token in `sessions` table.
 *  - Hash-chained audit logging for all authentication attempts (`login_success` / `login_failure`).
 */
@Injectable()
export class AdminLoginService {
  private readonly logger = new Logger(AdminLoginService.name);
  private readonly attemptTracker = new Map<string, FailedAttemptState>();

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
    const now = Date.now();

    // 1. Check temporary brute-force lockout status
    const state = this.attemptTracker.get(normalizedEmail);
    if (state?.lockedUntil && state.lockedUntil.getTime() > now) {
      // Execute dummy comparison to preserve timing uniformity even for locked accounts
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      await this.recordFailure(
        normalizedEmail,
        'account_locked',
        null,
        context,
      );
      return this.deny();
    }

    // 2. Fetch user together with role assignments
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

    // 3. Case: User not found or account is not password-based (e.g. Google-only).
    // Perform dummy bcrypt comparison to ensure uniform response timing.
    if (!user || user.authProvider !== 'local' || !user.passwordHash) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      return this.handleLoginFailure(
        normalizedEmail,
        'invalid_credentials',
        user?.id ?? null,
        context,
      );
    }

    // 4. Case: Password mismatch
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      return this.handleLoginFailure(
        normalizedEmail,
        'invalid_credentials',
        user.id,
        context,
      );
    }

    // 5. Case: Account suspended -> generic 401 (audited as account_suspended)
    if (user.status === 'SUSPENDED') {
      return this.handleLoginFailure(
        normalizedEmail,
        'account_suspended',
        user.id,
        context,
      );
    }

    // 6. Case: Account is not an administrator (neither platform scope nor SCHOOL_ADMIN)
    const isAdmin = user.assignments.some(
      (a) => a.role.scope === 'platform' || a.role.name === 'SCHOOL_ADMIN',
    );
    if (!isAdmin) {
      return this.handleLoginFailure(
        normalizedEmail,
        'not_admin',
        user.id,
        context,
      );
    }

    // 7. Success: clear failed attempts
    this.attemptTracker.delete(normalizedEmail);

    // 8. First-login activation: transition INVITED admin accounts to ACTIVE
    if (user.status === 'INVITED') {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE' },
      });
      user.status = 'ACTIVE';
    }

    // 9. Create stateful session with hashed refresh token rotation
    const effectiveDeviceId = deviceId ?? context.deviceId ?? null;
    const pair = await this.sessions.createSession(
      user.id,
      context,
      effectiveDeviceId,
    );

    // 10. Resolve primary admin assignment for audit trail
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

  /**
   * Tracks failed login attempts, triggers account lockout on threshold, and audits the failure.
   */
  private async handleLoginFailure(
    email: string,
    reason: LoginFailureReason,
    userId: string | null,
    context: AuditRequestContext,
  ): Promise<never> {
    const now = Date.now();
    let state = this.attemptTracker.get(email);
    if (!state || (state.lockedUntil && state.lockedUntil.getTime() <= now)) {
      state = { attempts: 0, lastAttemptAt: now, lockedUntil: null };
    }

    state.attempts += 1;
    state.lastAttemptAt = now;

    if (state.attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      const lockedUntil = new Date(now + ACCOUNT_LOCKOUT_DURATION_MS);
      state.lockedUntil = lockedUntil;
      try {
        await this.audit.record(
          AuditEvents.accountLocked(
            {
              email,
              userId,
              reason: 'too_many_failed_logins',
              failedAttempts: state.attempts,
              lockedUntil,
            },
            context,
          ),
        );
      } catch (err) {
        this.logger.error(
          'Failed to audit account lockout',
          err instanceof Error ? err.stack : err,
        );
      }
    }

    this.attemptTracker.set(email, state);
    this.pruneStaleAttempts();

    await this.recordFailure(email, reason, userId, context);
    return this.deny();
  }

  private async recordFailure(
    email: string,
    reason: LoginFailureReason,
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

  /**
   * Resets lockout tracker state (used for testing and administrative unlock).
   */
  resetLockout(email?: string): void {
    if (email) {
      this.attemptTracker.delete(email.trim().toLowerCase());
    } else {
      this.attemptTracker.clear();
    }
  }

  private pruneStaleAttempts(): void {
    if (this.attemptTracker.size < 1000) return;
    const now = Date.now();
    for (const [key, val] of this.attemptTracker.entries()) {
      if (val.lockedUntil && val.lockedUntil.getTime() > now) continue;
      if (now - val.lastAttemptAt > ACCOUNT_LOCKOUT_DURATION_MS) {
        this.attemptTracker.delete(key);
      }
    }
  }
}
