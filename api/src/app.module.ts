import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { appConfig, authConfig, databaseConfig, swaggerEnvConfig } from './config/index.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { PrismaModule } from './database/prisma.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { IdentityAndAccessModule } from './identity-and-access/identity-and-access.module.js';
import { MobileSyncModule } from './mobile-sync/mobile-sync.module.js';
import { RagPerformanceModule } from './rag-performance/rag-performance.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, authConfig, databaseConfig, swaggerEnvConfig],
    }),
    PrismaModule,
    AuthModule,
    IdentityAndAccessModule,
    DocumentsModule,
    ConversationsModule,
    RagPerformanceModule,
    MobileSyncModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
