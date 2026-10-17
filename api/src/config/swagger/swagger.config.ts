import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export interface SwaggerConfigOptions {
  title?: string;
  description?: string;
  version?: string;
  path?: string;
}

export function setupSwagger(app: INestApplication, options?: SwaggerConfigOptions): void {
  const title = options?.title ?? 'WAMDP Backend API';
  const description =
    options?.description ??
    'Advanced Web and Mobile Development Project - Backend API with MySQL 8 & RAG Architecture';
  const version = options?.version ?? '1.0.0';
  const path = options?.path ?? 'api/docs';

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
}
