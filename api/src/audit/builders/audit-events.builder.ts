import { AuditAction, AuditCategory } from '../constants/audit-events.constants.js';
import type { AuditActor, RecordAuditEventInput } from '../dto/record-audit-event.input.js';
import type { AuditRequestContext } from '../utils/audit-request-context.util.js';

/**
 * One builder per audited event, so every caller records the same shape.
 *
 *   await this.audit.record(
 *     AuditEvents.loginFailure({ email, reason: 'invalid_credentials', method: 'password' },
 *       auditContextFromRequest(req)),
 *   );
 *
 * Rule: record exactly one event per thing that happened. If a request already
 * recorded an event and then throws a 403, the access_denied filter skips it.
 */

export type LoginMethod = 'password' | 'google';

export type LoginFailureReason =
  | 'invalid_credentials'
  | 'account_suspended'
  | 'account_locked'
  | 'school_deactivated'
  | 'not_admin'
  | 'invalid_google_token'
  | 'domain_not_allowed'
  | 'unknown_user';

export type TokenRefreshFailureReason =
  | 'invalid_token'
  | 'expired'
  | 'revoked'
  | 'reused'
  | 'user_suspended'
  | 'school_deactivated'
  | 'session_not_found';

export type SessionRevocationReason = 'admin_action' | 'user_suspended' | 'token_reuse' | 'user_request';

const anonymous: AuditActor = { userId: null, role: null, schoolId: null };

export const AuditEvents = {
  loginSuccess(
    p: { userId: string; role?: string | null; schoolId?: string | null; method: LoginMethod; sessionId?: string },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.AUTHENTICATION,
      action: AuditAction.LOGIN_SUCCESS,
      actor: { userId: p.userId, role: p.role, schoolId: p.schoolId },
      entity: { type: 'user', id: p.userId },
      details: { method: p.method, sessionId: p.sessionId },
      context,
    };
  },

  /** Records the attempted email and IP. Never pass the password. */
  loginFailure(
    p: { email: string; reason: LoginFailureReason; method: LoginMethod; userId?: string | null },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.AUTHENTICATION,
      action: AuditAction.LOGIN_FAILURE,
      actor: anonymous,
      entity: { type: 'user', id: p.userId ?? null },
      details: { email: p.email.trim().toLowerCase(), reason: p.reason, method: p.method },
      context,
    };
  },

  logout(
    p: { userId: string; role?: string | null; schoolId?: string | null; sessionId: string },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.AUTHENTICATION,
      action: AuditAction.LOGOUT,
      actor: { userId: p.userId, role: p.role, schoolId: p.schoolId },
      entity: { type: 'session', id: p.sessionId },
      context,
    };
  },

  /** Never pass the refresh token itself; the session id is enough to investigate. */
  tokenRefreshFailure(
    p: { reason: TokenRefreshFailureReason; userId?: string | null; sessionId?: string | null },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.AUTHENTICATION,
      action: AuditAction.TOKEN_REFRESH_FAILURE,
      actor: { userId: p.userId ?? null },
      entity: { type: 'session', id: p.sessionId ?? null },
      details: { reason: p.reason },
      context,
    };
  },

  /** `revokedBy` is the admin who revoked it; omit when the system revoked it. */
  sessionRevoked(
    p: {
      sessionId: string;
      ownerUserId: string;
      reason: SessionRevocationReason;
      revokedBy?: AuditActor | null;
    },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.AUTHENTICATION,
      action: AuditAction.SESSION_REVOKED,
      actor: p.revokedBy ?? anonymous,
      entity: { type: 'session', id: p.sessionId },
      details: { ownerUserId: p.ownerUserId, reason: p.reason },
      context,
    };
  },

  userInvited(
    p: { invitedUserId: string; email: string; schoolId?: string | null; invitedBy?: AuditActor | null },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.IDENTITY_ACCESS,
      action: AuditAction.USER_INVITED,
      actor: p.invitedBy ?? anonymous,
      entity: { type: 'user', id: p.invitedUserId },
      details: { email: p.email.trim().toLowerCase(), schoolId: p.schoolId ?? null },
      context,
    };
  },

  accessDenied(
    p: { actor?: AuditActor | null; method: string; path: string; requiredPermission?: string; reason?: string },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.SECURITY,
      action: AuditAction.ACCESS_DENIED,
      actor: p.actor ?? anonymous,
      entity: { type: 'route', id: `${p.method} ${p.path}`.slice(0, 191) },
      details: { requiredPermission: p.requiredPermission, reason: p.reason },
      context,
    };
  },

  accountLocked(
    p: { email: string; userId?: string | null; reason: string; failedAttempts?: number; lockedUntil?: Date | null },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.SECURITY,
      action: AuditAction.ACCOUNT_LOCKED,
      actor: anonymous,
      entity: { type: 'user', id: p.userId ?? null },
      details: {
        email: p.email.trim().toLowerCase(),
        reason: p.reason,
        failedAttempts: p.failedAttempts,
        lockedUntil: p.lockedUntil ?? null,
      },
      context,
    };
  },
};
