import { Module } from '@nestjs/common';
import { AuditController } from './controllers/audit.controller.js';
import { AuditService } from './services/audit.service.js';

@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
