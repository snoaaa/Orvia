import { Logger, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createSwaggerAuthMiddleware } from './swagger-auth.middleware.js';

export interface SwaggerConfigOptions {
  title?: string;
  description?: string;
  version?: string;
  path?: string;
  enabled?: boolean;
  protected?: boolean;
  user?: string;
  password?: string;
}

export function setupSwagger(app: INestApplication, options?: SwaggerConfigOptions): boolean {
  const logger = new Logger('SwaggerSetup');

  const rawEnabled = process.env.SWAGGER_ENABLED?.trim();
  const enabled =
    options?.enabled !== undefined
      ? options.enabled
      : rawEnabled
        ? rawEnabled === 'true'
        : process.env.NODE_ENV !== 'production';

  if (!enabled) {
    logger.log('Swagger documentation is disabled in this environment.');
    return false;
  }

  const title = options?.title ?? 'WAMDP Backend API';
  const description =
    options?.description ??
    'Advanced Web and Mobile Development Project - Backend API with MySQL 8 & RAG Architecture';
  const version = options?.version ?? '1.0.0';
  const path = options?.path ?? 'api/docs';

  const rawProtected = process.env.SWAGGER_PROTECTED?.trim();
  const isProtected =
    options?.protected !== undefined
      ? options.protected
      : rawProtected
        ? rawProtected === 'true'
        : process.env.NODE_ENV === 'production';

  if (isProtected) {
    const user = options?.user || process.env.SWAGGER_USER?.trim() || 'admin';
    const password = options?.password || process.env.SWAGGER_PASSWORD?.trim() || 'admin';
    const authMiddleware = createSwaggerAuthMiddleware({ user, password });

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const httpAdapter = app.getHttpAdapter();

    httpAdapter.use(normalizedPath, authMiddleware);
    httpAdapter.use(`${normalizedPath}-json`, authMiddleware);
    httpAdapter.use(`${normalizedPath}-yaml`, authMiddleware);

    logger.log(`Swagger documentation endpoint [${normalizedPath}] is protected with Basic Auth.`);
  }

  const config = new DocumentBuilder()
    .setTitle(title)
    .setDescription(description)
    .setVersion(version)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter your JWT Bearer token',
        in: 'header',
      },
      'bearer-jwt',
    )
    .addTag('Health & Database', 'Health checks and database connectivity verification')
    .addTag('Authentication', 'Current user; login and refresh endpoints (#8, #10, #12)')
    .addTag('Identity and Access', 'Users, schools, groups, roles, permissions, and sessions')
    .addTag('Documents', 'Spaces, documents, versions, access control, and processing jobs')
    .addTag('Conversations', 'Conversations, messages, references, and saved answers')
    .addTag('RAG Performance', 'RAG request metrics, retrieval latency, and evaluation')
    .addTag('Mobile & Synchronization', 'Devices, offline selections, and sync changes')
    .addTag('Audit Trail', 'Append-only verifiable audit event logs')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup(path, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
    },
    customSiteTitle: 'WAMDP API Documentation',
  });

  logger.log(`Swagger documentation mounted on /${path}`);
  return true;
}
