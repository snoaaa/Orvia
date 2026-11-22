import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditContextFromRequest } from '../../audit/utils/audit-request-context.util.js';
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
  async createRole(
    @Body() dto: CreateRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<RoleEntity> {
    return this.identityService.createRole(dto, actor, auditContextFromRequest(req));
  }

  @Delete(':id')
  @RequirePermission('system:manage')
  @ApiOperation({
    summary: 'Delete an unused custom role (#46)',
    description:
      'Removes a custom role that nobody holds. `id` is a role UUID or its name (case-insensitive).\n\n' +
      '- **Base roles cannot be deleted** (400 `System base roles cannot be deleted`): the seed recreates them.\n' +
      '- **A role still assigned to users is refused** (400) with the exact count, e.g. ' +
      '`Cannot delete role \'X\': still assigned to 3 user(s). Please reassign them before deleting.` — ' +
      'reassign the holders first, then delete.\n' +
      '- Deleting a role also drops its permission rows and any document-access rule that granted it ' +
      '(both cascade); the count of dropped rules is recorded in the `identity_access/role_deleted` audit event.\n' +
      '- Unknown role → 404; a school-scoped `system:manage` holder (not a platform admin) → 403.',
  })
  @ApiParam({ name: 'id', description: 'Role UUID or name' })
  @ApiResponse({ status: 200, description: 'The role was deleted', schema: { example: { success: true, message: "Role 'TEACHING_ASSISTANT' was successfully deleted" } } })
  @ApiResponse({ status: 400, description: 'Base role, or a role still assigned to users (the message names the count)' })
  @ApiResponse({ status: 403, description: 'Not a platform admin (missing platform-wide system:manage)' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async deleteRole(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<{ success: boolean; message: string }> {
    return this.identityService.deleteRole(id, actor, auditContextFromRequest(req));
  }
}
