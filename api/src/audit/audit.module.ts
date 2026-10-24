import { Global, Module } from '@nestjs/common';
import { AuditDevController } from './controllers/audit-dev.controller.js';
import { AuditController } from './controllers/audit.controller.js';
import { AuditQueryService } from './services/audit-query.service.js';
import { AuditService } from './services/audit.service.js';

/** Global so any module (auth, identity, ...) can inject AuditService without importing it. */
@Global()
@Module({
  controllers: [AuditController, AuditDevController],
  providers: [AuditService, AuditQueryService],
  exports: [AuditService, AuditQueryService],
})
export class AuditModule {}
