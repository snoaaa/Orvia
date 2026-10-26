import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { AuditService } from './audit/services/audit.service.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { setupSwagger } from './config/swagger/index.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter(app.get(AuditService)));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) return callback(null, true);
      const allowedOrigins = [
        'http://localhost:4200',
        'http://localhost:3000',
        'http://localhost:8081',
        'http://127.0.0.1:4200',
        'http://127.0.0.1:3000',
      ];
      if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        callback(new Error('CORS policy: origin not allowed'));
      }
    },
    credentials: true,
  });

  app.enableShutdownHooks();

  setupSwagger(app, {
    title: 'WAMDP Backend API',
    description:
      'Advanced Web and Mobile Development Project - Backend API with MySQL 8 & RAG Architecture',
    version: '1.0.0',
    path: 'api/docs',
  });

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  logger.log(`WAMDP Backend Server is running on: http://localhost:${port}`);
  logger.log(`Swagger API Documentation available at: http://localhost:${port}/api/docs`);
  logger.log(`Database Health check at: http://localhost:${port}/health`);
}

await bootstrap();
