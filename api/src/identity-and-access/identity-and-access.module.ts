import { Module } from '@nestjs/common';
import { IdentityAndAccessController } from './controllers/identity-and-access.controller.js';
import { DomainValidationService } from './services/domain-validation.service.js';
import { IdentityAndAccessService } from './services/identity-and-access.service.js';

@Module({
  controllers: [IdentityAndAccessController],
  providers: [IdentityAndAccessService, DomainValidationService],
  exports: [IdentityAndAccessService, DomainValidationService],
})
export class IdentityAndAccessModule {}
