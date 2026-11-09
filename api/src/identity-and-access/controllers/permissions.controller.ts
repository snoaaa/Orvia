import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { PermissionEntity } from '../entities/index.js';
import { IdentityAndAccessService } from '../services/identity-and-access.service.js';

/** Permission catalogue used to build roles (Section 4.5): platform admins only. */
@ApiTags('Permissions')
@ApiBearerAuth('bearer-jwt')
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly identityService: IdentityAndAccessService) {}

  @Get()
  @RequirePermission('system:manage')
  @ApiOperation({
    summary: 'List every permission code with its description and category',
    description:
      'The permission codes roles are built from, as seeded, sorted by category then code. The category is the ' +
      "part of the code before the colon (e.g. 'users' for 'users:invite'). Platform admins only.",
  })
  @ApiResponse({ status: 200, description: 'All permissions', type: [PermissionEntity] })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Not a platform admin (missing platform-wide system:manage)' })
  async listPermissions(@CurrentUser() actor: AuthenticatedUser): Promise<PermissionEntity[]> {
    return this.identityService.listPermissions(actor);
  }
}
