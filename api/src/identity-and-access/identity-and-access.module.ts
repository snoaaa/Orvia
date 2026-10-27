import { Module } from '@nestjs/common';
import { IdentityAndAccessController } from './controllers/identity-and-access.controller.js';
import { DomainValidationService } from './services/domain-validation.service.js';
import { IdentityAndAccessService } from './services/identity-and-access.service.js';
import { InviteUserService } from './services/invite-user.service.js';

/**
 * Identity and Access Management module.
 * DomainValidationService is also registered in AuthModule (global) for cross-module use.
 * It is safe to have two instances because it is stateless (only wraps PrismaService queries).
 */
@Module({
  controllers: [IdentityAndAccessController],
  providers: [IdentityAndAccessService, InviteUserService, DomainValidationService],
  exports: [IdentityAndAccessService, InviteUserService, DomainValidationService],
})
export class IdentityAndAccessModule {}
