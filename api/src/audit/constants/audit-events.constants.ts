/**
 * Catalogue of audited actions (issue #14). Documented in api/README.md ("Audit trail").
 * Add new actions here rather than passing free-form strings to AuditService.record().
 */
export const AuditCategory = {
  AUTHENTICATION: 'authentication',
  IDENTITY_ACCESS: 'identity_access',
  SECURITY: 'security',
} as const;
export type AuditCategory = (typeof AuditCategory)[keyof typeof AuditCategory];

export const AuditAction = {
  // authentication
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAILURE: 'login_failure',
  LOGOUT: 'logout',
  TOKEN_REFRESH_FAILURE: 'token_refresh_failure',
  SESSION_REVOKED: 'session_revoked',
  // identity_access
  USER_INVITED: 'user_invited',
  PASSWORD_SETUP: 'password_setup',
  // security
  ACCESS_DENIED: 'access_denied',
  ACCOUNT_LOCKED: 'account_locked',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** Which category each action belongs to. */
export const AUDIT_ACTION_CATEGORY: Record<AuditAction, AuditCategory> = {
  [AuditAction.LOGIN_SUCCESS]: AuditCategory.AUTHENTICATION,
  [AuditAction.LOGIN_FAILURE]: AuditCategory.AUTHENTICATION,
  [AuditAction.LOGOUT]: AuditCategory.AUTHENTICATION,
  [AuditAction.TOKEN_REFRESH_FAILURE]: AuditCategory.AUTHENTICATION,
  [AuditAction.SESSION_REVOKED]: AuditCategory.AUTHENTICATION,
  [AuditAction.USER_INVITED]: AuditCategory.IDENTITY_ACCESS,
  [AuditAction.PASSWORD_SETUP]: AuditCategory.IDENTITY_ACCESS,
  [AuditAction.ACCESS_DENIED]: AuditCategory.SECURITY,
  [AuditAction.ACCOUNT_LOCKED]: AuditCategory.SECURITY,
};

/** Primary key of the single audit_chain_head row. */
export const AUDIT_CHAIN_HEAD_ID = 1;

/** prev_hash of the very first event in the chain. */
export const AUDIT_GENESIS_HASH = '0'.repeat(64);

/** Bumped if the hashed payload layout ever changes, so old rows stay verifiable. */
export const AUDIT_HASH_VERSION = 1;
