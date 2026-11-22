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

/** The mutable fields of a school, as they were before a change or became after it (#5). */
export interface SchoolSnapshot {
  name: string;
  status: string;
  domains: string[];
  settings?: unknown;
}

/** `{ before, after }` for one changed field. */
export type FieldChange = { before: unknown; after: unknown };

/** The fields a school or domain change actually touched, keyed by field name. */
export type SchoolChanges = Record<string, FieldChange>;

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

  passwordSetup(
    p: { userId: string; email: string; role?: string | null; schoolId?: string | null },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.IDENTITY_ACCESS,
      action: AuditAction.PASSWORD_SETUP,
      actor: { userId: p.userId, role: p.role ?? null, schoolId: p.schoolId ?? null },
      entity: { type: 'user', id: p.userId },
      details: { email: p.email.trim().toLowerCase(), method: 'setup_token' },
      context,
    };
  },

  /**
   * A user's role in one school was created or changed. `previousRole` is null when the
   * assignment did not exist before.
   */
  roleAssigned(
    p: {
      userId: string;
      email: string;
      schoolId: string;
      role: string;
      previousRole?: string | null;
      /** Group of the assignment (POST /assignments); left out of the details when not given. */
      groupId?: string | null;
      assignedBy?: AuditActor | null;
    },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.IDENTITY_ACCESS,
      action: AuditAction.ROLE_ASSIGNED,
      actor: p.assignedBy ?? anonymous,
      entity: { type: 'user', id: p.userId },
      details: {
        email: p.email.trim().toLowerCase(),
        schoolId: p.schoolId,
        ...(p.groupId !== undefined ? { groupId: p.groupId } : {}),
        role: p.role,
        previousRole: p.previousRole ?? null,
      },
      context,
    };
  },

  /**
   * A school was registered (`POST /schools`, #5, §4.5). `before` is null: there was no school.
   *
   * The `after` snapshot carries the mutable fields the platform cares about; `settings` goes through
   * `redactSecrets()` like every other detail, so a provider key stored there is stored as "[REDACTED]".
   */
  schoolCreated(
    p: { schoolId: string; snapshot: SchoolSnapshot; createdBy?: AuditActor | null },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.IDENTITY_ACCESS,
      action: AuditAction.SCHOOL_CREATED,
      actor: p.createdBy ?? anonymous,
      entity: { type: 'school', id: p.schoolId },
      details: { school: p.snapshot.name, before: null, after: p.snapshot },
      context,
    };
  },

  /**
   * A school's name, settings or allowed domains were edited (`PATCH /schools/:id`, #5).
   *
   * `changes` only holds the fields that really moved, each as `{ before, after }`; the caller records
   * nothing at all when the payload changes nothing.
   */
  schoolUpdated(
    p: { schoolId: string; school: string; changes: SchoolChanges; updatedBy?: AuditActor | null },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.IDENTITY_ACCESS,
      action: AuditAction.SCHOOL_UPDATED,
      actor: p.updatedBy ?? anonymous,
      entity: { type: 'school', id: p.schoolId },
      details: { school: p.school, changes: p.changes },
      context,
    };
  },

  /** A school was deactivated (`PATCH /schools/:id/deactivate`, #5, §4.5). */
  schoolDeactivated(
    p: { schoolId: string; school: string; previousStatus: string; deactivatedBy?: AuditActor | null },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.IDENTITY_ACCESS,
      action: AuditAction.SCHOOL_DEACTIVATED,
      actor: p.deactivatedBy ?? anonymous,
      entity: { type: 'school', id: p.schoolId },
      details: { school: p.school, changes: { status: { before: p.previousStatus, after: 'deactivated' } } },
      context,
    };
  },

  /** A school was reactivated (`PATCH /schools/:id/reactivate`, #5, §4.5). */
  schoolReactivated(
    p: { schoolId: string; school: string; previousStatus: string; reactivatedBy?: AuditActor | null },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.IDENTITY_ACCESS,
      action: AuditAction.SCHOOL_REACTIVATED,
      actor: p.reactivatedBy ?? anonymous,
      entity: { type: 'school', id: p.schoolId },
      details: { school: p.school, changes: { status: { before: p.previousStatus, after: 'active' } } },
      context,
    };
  },

  /**
   * An email domain was allowed for a school (`POST /schools/:id/domains`, #5, §4.6).
   *
   * `changes.domains` holds the whole allowed-domain set before and after, so a reader sees the effect
   * on the school's login and invitation rules rather than just the row that was inserted.
   */
  schoolDomainAdded(
    p: {
      schoolId: string;
      school: string;
      domain: string;
      domainsBefore: string[];
      domainsAfter: string[];
      addedBy?: AuditActor | null;
    },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.IDENTITY_ACCESS,
      action: AuditAction.SCHOOL_DOMAIN_ADDED,
      actor: p.addedBy ?? anonymous,
      entity: { type: 'school', id: p.schoolId },
      details: {
        school: p.school,
        domain: p.domain,
        changes: { domains: { before: p.domainsBefore, after: p.domainsAfter } },
      },
      context,
    };
  },

  /** An email domain was removed from a school (`DELETE /schools/:id/domains/:domainId`, #5, §4.6). */
  schoolDomainRemoved(
    p: {
      schoolId: string;
      school: string;
      domain: string;
      domainsBefore: string[];
      domainsAfter: string[];
      removedBy?: AuditActor | null;
    },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.IDENTITY_ACCESS,
      action: AuditAction.SCHOOL_DOMAIN_REMOVED,
      actor: p.removedBy ?? anonymous,
      entity: { type: 'school', id: p.schoolId },
      details: {
        school: p.school,
        domain: p.domain,
        changes: { domains: { before: p.domainsBefore, after: p.domainsAfter } },
      },
      context,
    };
  },

  /**
   * Document-management or other fine-grained permission granted to a staff member in a school (§4.5, #88).
   */
  permissionGranted(
    p: {
      userId: string;
      email?: string | null;
      schoolId: string;
      permission: string;
      grantedBy?: AuditActor | null;
    },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.IDENTITY_ACCESS,
      action: AuditAction.PERMISSION_GRANTED,
      actor: p.grantedBy ?? anonymous,
      entity: { type: 'user', id: p.userId },
      details: {
        permission: p.permission,
        schoolId: p.schoolId,
        ...(p.email ? { email: p.email.trim().toLowerCase() } : {}),
      },
      context,
    };
  },

  /**
   * Document-management or other fine-grained permission revoked from a staff member in a school (§4.5, #88).
   */
  permissionRevoked(
    p: {
      userId: string;
      email?: string | null;
      schoolId: string;
      permission: string;
      revokedBy?: AuditActor | null;
    },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.IDENTITY_ACCESS,
      action: AuditAction.PERMISSION_REVOKED,
      actor: p.revokedBy ?? anonymous,
      entity: { type: 'user', id: p.userId },
      details: {
        permission: p.permission,
        schoolId: p.schoolId,
        ...(p.email ? { email: p.email.trim().toLowerCase() } : {}),
      },
      context,
    };
  },

  /**
   * The role and/or group of an existing assignment changed (PATCH /assignments/:id, #48).
   * The school of an assignment never changes, so only the role and the group have a previous value.
   */
  assignmentUpdated(
    p: {
      assignmentId: string;
      userId: string;
      email: string;
      schoolId: string;
      role: string;
      previousRole: string;
      groupId: string | null;
      previousGroupId: string | null;
      updatedBy: AuditActor;
    },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.IDENTITY_ACCESS,
      action: AuditAction.ASSIGNMENT_UPDATED,
      actor: p.updatedBy,
      entity: { type: 'user', id: p.userId },
      details: {
        assignmentId: p.assignmentId,
        email: p.email.trim().toLowerCase(),
        schoolId: p.schoolId,
        role: p.role,
        previousRole: p.previousRole,
        groupId: p.groupId,
        previousGroupId: p.previousGroupId,
      },
      context,
    };
  },

  /** An assignment was removed (DELETE /assignments/:id, #49, soft delete): the user loses that role in the school. */
  assignmentRemoved(
    p: {
      assignmentId: string;
      userId: string;
      email: string;
      schoolId: string;
      role: string;
      groupId: string | null;
      removedBy: AuditActor;
    },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.IDENTITY_ACCESS,
      action: AuditAction.ASSIGNMENT_REMOVED,
      actor: p.removedBy,
      entity: { type: 'user', id: p.userId },
      details: {
        assignmentId: p.assignmentId,
        email: p.email.trim().toLowerCase(),
        schoolId: p.schoolId,
        role: p.role,
        groupId: p.groupId,
      },
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

  documentUploaded(
    p: {
      documentId: string;
      spaceId: string;
      schoolId: string;
      versionNo: number;
      versionId: string;
      checksum: string;
      mimeType: string;
      actor: { userId: string; role?: string | null; schoolId?: string | null };
    },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.DOCUMENTS,
      action: AuditAction.DOCUMENT_UPLOADED,
      actor: {
        userId: p.actor.userId,
        role: p.actor.role ?? null,
        schoolId: p.actor.schoolId ?? null,
      },
      entity: { type: 'document', id: p.documentId },
      details: {
        spaceId: p.spaceId,
        schoolId: p.schoolId,
        versionNo: p.versionNo,
        versionId: p.versionId,
        checksum: p.checksum,
        mimeType: p.mimeType,
      },
      context,
    };
  },

  documentUpdated(
    p: {
      documentId: string;
      spaceId: string;
      schoolId: string;
      actor: { userId: string; role?: string | null; schoolId?: string | null };
      changes: Record<string, { from: unknown; to: unknown }>;
    },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.DOCUMENTS,
      action: AuditAction.DOCUMENT_UPDATED,
      actor: {
        userId: p.actor.userId,
        role: p.actor.role ?? null,
        schoolId: p.actor.schoolId ?? null,
      },
      entity: { type: 'document', id: p.documentId },
      details: {
        spaceId: p.spaceId,
        schoolId: p.schoolId,
        changes: p.changes,
      },
      context,
    };
  },

  documentReplaced(
    p: {
      documentId: string;
      spaceId: string;
      schoolId: string;
      versionNo: number;
      versionId: string;
      checksum: string;
      mimeType: string;
      actor: { userId: string; role?: string | null; schoolId?: string | null };
    },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.DOCUMENTS,
      action: AuditAction.DOCUMENT_REPLACED,
      actor: {
        userId: p.actor.userId,
        role: p.actor.role ?? null,
        schoolId: p.actor.schoolId ?? null,
      },
      entity: { type: 'document', id: p.documentId },
      details: {
        spaceId: p.spaceId,
        schoolId: p.schoolId,
        versionNo: p.versionNo,
        versionId: p.versionId,
        checksum: p.checksum,
        mimeType: p.mimeType,
      },
      context,
    };
  },

  documentDeleted(
    p: {
      documentId: string;
      spaceId: string;
      schoolId: string;
      title: string;
      versionsCount: number;
      actor: { userId: string; role?: string | null; schoolId?: string | null };
    },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.DOCUMENTS,
      action: AuditAction.DOCUMENT_DELETED,
      actor: {
        userId: p.actor.userId,
        role: p.actor.role ?? null,
        schoolId: p.actor.schoolId ?? null,
      },
      entity: { type: 'document', id: p.documentId },
      details: {
        spaceId: p.spaceId,
        schoolId: p.schoolId,
        title: p.title,
        versionsCount: p.versionsCount,
      },
      context,
    };
  },
  /** A document was published to new targets (#109). `rules` lists only the targets this request added. */
  documentPublished(
    p: {
      documentId: string;
      spaceId: string;
      schoolId: string;
      rules: { type: string; targetId: string }[];
      actor: { userId: string; role?: string | null; schoolId?: string | null };
    },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.DOCUMENTS,
      action: AuditAction.DOCUMENT_PUBLISHED,
      actor: {
        userId: p.actor.userId,
        role: p.actor.role ?? null,
        schoolId: p.actor.schoolId ?? null,
      },
      entity: { type: 'document', id: p.documentId },
      details: {
        spaceId: p.spaceId,
        schoolId: p.schoolId,
        rules: p.rules,
      },
      context,
    };
  },
  /** The rules of a document were replaced or one was removed (#110): the targets added and removed. */
  documentAccessChanged(
    p: {
      documentId: string;
      spaceId: string;
      schoolId: string;
      added: { type: string; targetId: string }[];
      removed: { type: string; targetId: string }[];
      actor: { userId: string; role?: string | null; schoolId?: string | null };
    },
    context: AuditRequestContext,
  ): RecordAuditEventInput {
    return {
      category: AuditCategory.DOCUMENTS,
      action: AuditAction.DOCUMENT_ACCESS_CHANGED,
      actor: {
        userId: p.actor.userId,
        role: p.actor.role ?? null,
        schoolId: p.actor.schoolId ?? null,
      },
      entity: { type: 'document', id: p.documentId },
      details: {
        spaceId: p.spaceId,
        schoolId: p.schoolId,
        added: p.added,
        removed: p.removed,
      },
      context,
    };
  },
};
