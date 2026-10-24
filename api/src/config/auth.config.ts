export interface AuthConfig {
  jwtAccessSecret: string;
  jwtAccessTtlSeconds: number;
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
      devTools: process.env.AUTH_DEV_TOOLS === 'true' && !isProduction,
    },
  };
};
