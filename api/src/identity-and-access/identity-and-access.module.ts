import { Module } from '@nestjs/common';
import { IdentityAndAccessController } from './controllers/identity-and-access.controller.js';
import { IdentityAndAccessService } from './services/identity-and-access.service.js';

@Module({
  controllers: [IdentityAndAccessController],
  providers: [IdentityAndAccessService],
  exports: [IdentityAndAccessService],
})
export class IdentityAndAccessModule {}
