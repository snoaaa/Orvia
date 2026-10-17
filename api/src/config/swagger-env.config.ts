export interface SwaggerEnvConfig {
  enabled: boolean;
  isProtected: boolean;
  user: string;
  pass: string;
}

export const swaggerEnvConfig = (): { swagger: SwaggerEnvConfig } => ({
  swagger: {
    enabled: process.env.SWAGGER_ENABLED !== 'false',
    isProtected: process.env.SWAGGER_PROTECTED === 'true',
    user: process.env.SWAGGER_USER || 'admin',
    pass: process.env.SWAGGER_PASSWORD || 'admin',
  },
});
