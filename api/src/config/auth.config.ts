export interface AuthConfig {
  jwtAccessSecret: string;
  jwtAccessTtlSeconds: number;
  /** Absolute session lifetime: refreshing does not extend it. */
  refreshTtlDays: number;
  /** Expired / revoked sessions older than this are deleted by the daily cleanup. */
  sessionRetentionDays: number;
  /**
   * Seconds during which the refresh token replaced by the last rotation is still accepted
   * (automatic retry after a network hiccup) instead of being treated as theft. 0 = strict.
   */
  refreshReuseGraceSeconds: number;
  devTools: boolean;
  /**
   * Google OAuth 2.0 Client IDs (comma-separated).
   * The Google ID token's `aud` claim must match one of these.
   * At least one is required for Google login (#10) to work.
   */
  googleClientIds: string[];
}

const DEV_FALLBACK_SECRET = 'wamdp-dev-only-secret-change-me';

export const authConfig = (): { auth: AuthConfig } => {
  const isProduction = process.env.NODE_ENV === 'production';
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret && isProduction) {
    throw new Error('JWT_ACCESS_SECRET must be set in production.');
  }

  const googleClientIdsRaw = process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || '';
  const googleClientIds = googleClientIdsRaw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  // SECURITY (Issue #10): In production, at least one Google Client ID MUST be configured.
  // Leaving GOOGLE_CLIENT_IDS empty would cause the audience check in verifyGoogleToken to
  // accept any valid Google ID token minted for ANY app — a Confused Deputy vulnerability.
  if (isProduction && googleClientIds.length === 0) {
    throw new Error(
      'GOOGLE_CLIENT_IDS must be set in production. ' +
      'Leaving it empty would accept any Google ID token from any OAuth app, ' +
      'creating a Confused Deputy security vulnerability.',
    );
  }

  return {
    auth: {
      jwtAccessSecret: secret || DEV_FALLBACK_SECRET,
      jwtAccessTtlSeconds: parseInt(process.env.JWT_ACCESS_TTL_SECONDS || '900', 10),
      refreshTtlDays: parseInt(process.env.JWT_REFRESH_TTL_DAYS || '30', 10),
      sessionRetentionDays: parseInt(process.env.SESSION_RETENTION_DAYS || '30', 10),
      refreshReuseGraceSeconds: parseInt(process.env.REFRESH_REUSE_GRACE_SECONDS || '10', 10),
      devTools: process.env.AUTH_DEV_TOOLS === 'true' && !isProduction,
      googleClientIds,
    },
  };
};
