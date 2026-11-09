import { Module } from '@nestjs/common';
import { GroupsController } from './controllers/groups.controller.js';
import { IdentityAndAccessController } from './controllers/identity-and-access.controller.js';
import { PermissionsController } from './controllers/permissions.controller.js';
import { RolesController } from './controllers/roles.controller.js';
import { SchoolsController } from './controllers/schools.controller.js';
import { UsersController } from './controllers/users.controller.js';
import { DomainValidationService } from './services/domain-validation.service.js';
import { GroupsService } from './services/groups.service.js';
import { IdentityAndAccessService } from './services/identity-and-access.service.js';

@Module({
  controllers: [
    IdentityAndAccessController,
    SchoolsController,
    UsersController,
    GroupsController,
    PermissionsController,
    RolesController,
  ],
  providers: [IdentityAndAccessService, DomainValidationService, GroupsService],
  exports: [IdentityAndAccessService, DomainValidationService, GroupsService],
})
export class IdentityAndAccessModule {}
