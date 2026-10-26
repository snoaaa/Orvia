import type { AuditAction, AuditCategory } from '../constants/audit-events.constants.js';
import type { AuditRequestContext } from '../utils/audit-request-context.util.js';

/** Who performed the action. Null actor = anonymous (e.g. a failed login). */
export interface AuditActor {
  userId: string | null;
  role?: string | null;
  schoolId?: string | null;
}

/**
 * Internal input of AuditService.record(). Not an HTTP DTO: audit events are only
 * produced by the backend itself, never posted by clients.
 * Prefer the builders in `AuditEvents` over filling this by hand.
 */
export interface RecordAuditEventInput {
  category: AuditCategory;
  action: AuditAction;
  actor: AuditActor;
  entity?: { type: string; id?: string | null } | null;
  /** Free-form context. Secrets are stripped automatically, but do not pass them anyway. */
  details?: Record<string, unknown>;
  context: AuditRequestContext;
}
