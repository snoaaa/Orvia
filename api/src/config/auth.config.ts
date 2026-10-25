export interface AuthConfig {
  jwtAccessSecret: string;
  jwtAccessTtlSeconds: number;
  /** Absolute session lifetime: refreshing does not extend it. */
  refreshTtlDays: number;
  /** Expired / revoked sessions older than this are deleted by the daily cleanup. */
  sessionRetentionDays: number;
  devTools: boolean;
}

const DEV_FALLBACK_SECRET = 'wamdp-dev-only-secret-change-me';

export const authConfig = (): { auth: AuthConfig } => {
  const isProduction = process.env.NODE_ENV === 'production';
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret && isProduction) {
    throw new Error('JWT_ACCESS_SECRET must be set in production.');
  }
  return {
    auth: {
      jwtAccessSecret: secret || DEV_FALLBACK_SECRET,
      jwtAccessTtlSeconds: parseInt(process.env.JWT_ACCESS_TTL_SECONDS || '900', 10),
      refreshTtlDays: parseInt(process.env.JWT_REFRESH_TTL_DAYS || '30', 10),
      sessionRetentionDays: parseInt(process.env.SESSION_RETENTION_DAYS || '30', 10),
      devTools: process.env.AUTH_DEV_TOOLS === 'true' && !isProduction,
    },
  };
};
