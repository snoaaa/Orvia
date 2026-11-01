import { Module } from '@nestjs/common';
import { IdentityAndAccessController } from './controllers/identity-and-access.controller.js';
import { DomainValidationService } from './services/domain-validation.service.js';
import { IdentityAndAccessService } from './services/identity-and-access.service.js';

/**
 * Identity and Access Management module.
 * DomainValidationService is defined and exported here as the single source of truth.
 * AuthModule consumes it by importing IdentityAndAccessModule (not by re-registering it).
 */
@Module({
  controllers: [IdentityAndAccessController],
  providers: [IdentityAndAccessService, DomainValidationService],
  exports: [IdentityAndAccessService, DomainValidationService],
})
export class IdentityAndAccessModule {}
