/** One row of the read-only audit trail (`GET /audit/events`, #96). */
export interface AuditEvent {
  id: string;
  seq: string;
  category: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  schoolId: string | null;
  schoolName: string | null;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  deviceId: string | null;
  /** Free-form context; before/after values live here (`changes`, `previous*`) when they exist. */
  details: Record<string, unknown>;
  createdAt: string;
}

export interface PaginatedAuditEvents {
  data: AuditEvent[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditEventFilter {
  page: number;
  limit: number;
  /** ISO 8601 instants. */
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  schoolId?: string;
}

/** Audited actions (mirrors `AuditAction` in `api/src/audit/constants/audit-events.constants.ts`). */
export const AUDIT_ACTIONS: readonly string[] = [
  'login_success',
  'login_failure',
  'logout',
  'token_refresh_failure',
  'session_revoked',
  'user_invited',
  'password_setup',
  'role_assigned',
  'role_updated',
  'role_deleted',
  'school_created',
  'school_updated',
  'school_deactivated',
  'school_reactivated',
  'school_domain_added',
  'school_domain_removed',
  'permission_granted',
  'permission_revoked',
  'assignment_updated',
  'assignment_removed',
  'access_denied',
  'account_locked',
  'document_uploaded',
  'document_updated',
  'document_replaced',
  'document_deleted',
  'document_published',
  'document_access_changed',
  'space_created',
  'space_updated',
  'space_deleted'
];
