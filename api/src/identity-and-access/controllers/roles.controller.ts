import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { CreateRoleDto } from '../dto/index.js';
import { RoleEntity } from '../entities/index.js';
import { IdentityAndAccessService } from '../services/identity-and-access.service.js';

/** Role management (Section 4.5): roles with permissions and a documentary scope. Platform admins only. */
@ApiTags('Roles')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@ApiResponse({ status: 403, description: 'Not a platform admin (missing platform-wide system:manage)' })
@Controller('roles')
export class RolesController {
  constructor(private readonly identityService: IdentityAndAccessService) {}

  @Post()
  @RequirePermission('system:manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a role with its scope and permissions (Section 4.5)',
    description:
      'The name is stored in upper case and must be unique, ignoring case (409); the six base role names are ' +
      "reserved (400). The scope is 'platform', 'school' or 'group'. Permissions are codes from GET /permissions; " +
      'an unknown code is rejected (400) and nothing is created. Platform admins only.',
  })
  @ApiResponse({ status: 201, description: 'The created role with its permission codes', type: RoleEntity })
  @ApiResponse({
    status: 400,
    description: 'Invalid name, scope or permission list, unknown permission code, or reserved base role name',
  })
  @ApiResponse({ status: 409, description: 'A role with this name already exists' })
  async createRole(@Body() dto: CreateRoleDto, @CurrentUser() actor: AuthenticatedUser): Promise<RoleEntity> {
    return this.identityService.createRole(dto, actor);
  }
}
