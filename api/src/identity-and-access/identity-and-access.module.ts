import { Module } from '@nestjs/common';
import { AssignmentsController } from './controllers/assignments.controller.js';
import { GroupsController } from './controllers/groups.controller.js';
import { IdentityAndAccessController } from './controllers/identity-and-access.controller.js';
import { PermissionsController } from './controllers/permissions.controller.js';
import { RolesController } from './controllers/roles.controller.js';
import { SchoolDomainsController } from './controllers/school-domains.controller.js';
import { SchoolsController } from './controllers/schools.controller.js';
import { UsersController } from './controllers/users.controller.js';
import { AssignmentsService } from './services/assignments.service.js';
import { DomainValidationService } from './services/domain-validation.service.js';
import { GroupsService } from './services/groups.service.js';
import { IdentityAndAccessService } from './services/identity-and-access.service.js';
import { SchoolDomainsService } from './services/school-domains.service.js';

@Module({
  controllers: [
    IdentityAndAccessController,
    SchoolsController,
    SchoolDomainsController,
    UsersController,
    GroupsController,
    PermissionsController,
    RolesController,
    AssignmentsController,
  ],
  providers: [IdentityAndAccessService, DomainValidationService, GroupsService, AssignmentsService, SchoolDomainsService],
  exports: [IdentityAndAccessService, DomainValidationService, GroupsService, AssignmentsService, SchoolDomainsService],
})
export class IdentityAndAccessModule {}
