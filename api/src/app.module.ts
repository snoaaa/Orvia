import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { appConfig, authConfig, databaseConfig, storageConfig, swaggerEnvConfig } from './config/index.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { PrismaModule } from './database/prisma.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { IdentityAndAccessModule } from './identity-and-access/identity-and-access.module.js';
import { MobileSyncModule } from './mobile-sync/mobile-sync.module.js';
import { OverviewModule } from './overview/overview.module.js';
import { RagPerformanceModule } from './rag-performance/rag-performance.module.js';
import { StorageModule } from './storage/storage.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, authConfig, databaseConfig, storageConfig, swaggerEnvConfig],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    StorageModule,
    AuthModule,
    IdentityAndAccessModule,
    DocumentsModule,
    ConversationsModule,
    RagPerformanceModule,
    MobileSyncModule,
    OverviewModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
