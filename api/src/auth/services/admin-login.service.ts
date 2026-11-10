import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import argon2 from 'argon2';
import {
  AuditEvents,
  type LoginFailureReason,
} from '../../audit/builders/audit-events.builder.js';
import { AuditService } from '../../audit/services/audit.service.js';
import type { AuditRequestContext } from '../../audit/utils/audit-request-context.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import { hasAdminAccess, isAdminRole, toClassifiableRoles } from '../utils/admin-role.util.js';
import { SessionService, type TokenPair } from './session.service.js';
import { ACTIVE_ASSIGNMENT } from '../utils/active-assignment.util.js';

/**
 * Precomputed argon2id hash of a throwaway string, used as the comparison target when there is no
 * real hash to check (unknown email, locked account, Google-only account). Verifying against it
 * costs the same as a real verification, so response time does not reveal whether the account
 * exists.
 */
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$rsXLORTGGnL2J5XcnHFjKA$Dck5hTtS+S2m1j/p0Yia9pgEaOhgKEbxd7We1NVwPlk';

/** argon2 verify, treating a malformed/legacy hash as "no match" instead of throwing. */
async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

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
 *  - Constant-time execution (dummy argon2 comparison) to prevent timing side-channels.
 *  - Password-only accounts (`authProvider === 'local'` and `passwordHash !== null`), argon2id hashes.
 *  - Generic 401 on credential mismatch, suspended status, or non-admin accounts.
 *  - Admin role requirement: a platform-scoped role, or any role granting an administrative
 *    permission (see `auth/utils/admin-role.util.ts`) — no role name is hardcoded.
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
      await verifyPassword(DUMMY_ARGON2_HASH, password);
      await this.recordFailure(
        normalizedEmail,
        'account_locked',
        null,
        context,
      );
      return this.deny();
    }

    // 2. Fetch user together with role assignments and their permissions
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        assignments: {
          where: ACTIVE_ASSIGNMENT,
          include: {
            role: {
              select: {
                name: true,
                scope: true,
                rolePermissions: { select: { permission: { select: { code: true } } } },
              },
            },
            school: { select: { id: true, name: true, status: true } },
          },
        },
      },
    });

    // 3. Case: User not found or account is not password-based (e.g. Google-only).
    // Perform dummy argon2 comparison to ensure uniform response timing.
    if (!user || user.authProvider !== 'local' || !user.passwordHash) {
      await verifyPassword(DUMMY_ARGON2_HASH, password);
      return this.handleLoginFailure(
        normalizedEmail,
        'invalid_credentials',
        user?.id ?? null,
        context,
      );
    }

    // 4. Case: Password mismatch (argon2id only)
    const passwordValid = await verifyPassword(user.passwordHash, password);
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

    // 6. Case: Account is not an administrator. Admin-ness comes from data, not from a role name:
    // a platform-scoped role, or a role granting an administrative permission.
    const roles = toClassifiableRoles(user.assignments);
    if (!hasAdminAccess(roles)) {
      return this.handleLoginFailure(
        normalizedEmail,
        'not_admin',
        user.id,
        context,
      );
    }

    // 6b. Case: School admin or user belonging to a deactivated school
    const isPlatformAdmin = user.assignments.some(
      (a) => a.role.scope === 'platform',
    );
    if (!isPlatformAdmin && user.assignments.length > 0) {
      const isDeactivated = user.assignments.every(
        (a) => a.school?.status === 'deactivated',
      );
      if (isDeactivated) {
        return this.handleLoginFailure(
          normalizedEmail,
          'school_deactivated',
          user.id,
          context,
        );
      }
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

    // 10. Resolve primary admin assignment for audit trail (platform scope first, then admin roles)
    const platformIndex = roles.findIndex((r) => r.scope === 'platform');
    const adminIndex = platformIndex >= 0 ? platformIndex : roles.findIndex(isAdminRole);
    const adminAssignment = user.assignments[adminIndex >= 0 ? adminIndex : 0];

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
  /**
   * Sets initial password for an invited administrator using a single-use expiring setup token (Issue #26).
   */
  async setupPassword(
    rawToken: string,
    newPassword: string,
    context: AuditRequestContext,
  ): Promise<{ message: string }> {
    const trimmedToken = (rawToken || '').trim();
    if (!trimmedToken) {
      throw new BadRequestException('Setup token is required');
    }

    const tokenHash = createHash('sha256').update(trimmedToken).digest('hex');

    const tokenRecord = await this.prisma.passwordSetupToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            assignments: {
              where: ACTIVE_ASSIGNMENT,
              include: {
                role: { select: { name: true, scope: true } },
                school: { select: { id: true, status: true } },
              },
            },
          },
        },
      },
    });

    if (!tokenRecord) {
      throw new BadRequestException('Invalid or expired setup token');
    }

    if (tokenRecord.usedAt !== null) {
      throw new BadRequestException('Setup token has already been used');
    }

    if (tokenRecord.expiresAt <= new Date()) {
      throw new BadRequestException('Setup token has expired');
    }

    if (tokenRecord.user.status === 'SUSPENDED') {
      throw new ForbiddenException('Account is suspended');
    }

    // Password validation rules (min length 8, max length 128)
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }

    if (newPassword.length > 128) {
      throw new BadRequestException('Password cannot exceed 128 characters');
    }

    // Hash password with argon2id
    const passwordHash = await argon2.hash(newPassword);

    // Atomically set password, change status to ACTIVE, authProvider to local, and mark token as used
    await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.passwordSetupToken.updateMany({
        where: { id: tokenRecord.id, usedAt: null },
        data: {
          usedAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        throw new BadRequestException('Setup token has already been used');
      }

      await tx.user.update({
        where: { id: tokenRecord.userId },
        data: {
          passwordHash,
          authProvider: 'local',
          status: 'ACTIVE',
        },
      });
    });

    // Tamper-evident audit logging (NEVER record or log the password or hash)
    const primaryAssignment = tokenRecord.user.assignments[0];
    await this.audit.record(
      AuditEvents.passwordSetup(
        {
          userId: tokenRecord.userId,
          email: tokenRecord.user.email,
          role: primaryAssignment?.role?.name ?? null,
          schoolId: primaryAssignment?.schoolId ?? null,
        },
        context,
      ),
    );

    return {
      message: 'Password set up successfully. Account is now active and ready for login.',
    };
  }

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
