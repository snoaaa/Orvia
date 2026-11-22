import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditContextFromRequest } from '../../audit/utils/audit-request-context.util.js';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { CreateRoleDto, UpdateRoleDto } from '../dto/index.js';
import { RoleEntity } from '../entities/index.js';
import { IdentityAndAccessService } from '../services/identity-and-access.service.js';

/**
 * Role management (Section 4.5): roles with permissions and a documentary scope.
 *
 * Reading (`GET`) is open to every admin who may assign roles; writing (`POST`, `PATCH`) is reserved
 * to platform admins. A role that grants `system:manage` must be platform-scoped, so a school or group
 * role can never administer the platform. The base roles are read-only: they are recreated by the seed.
 */
@ApiTags('Roles')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@Controller('roles')
export class RolesController {
  constructor(private readonly identityService: IdentityAndAccessService) {}

  @Get()
  @RequirePermission('users:assign_role')
  @ApiOperation({
    summary: 'List roles with the permissions each one grants',
    description:
      'Every role, sorted by name, with its scope, permission codes, permission ids, how many active users hold it ' +
      '(`assignedUsersCount`) and whether it is a protected base role (`isBase`). Platform admins and school admins.',
  })
  @ApiResponse({ status: 200, description: 'The roles with their permissions', type: [RoleEntity] })
  @ApiResponse({ status: 403, description: 'Missing users:assign_role' })
  async listRoles(): Promise<RoleEntity[]> {
    return this.identityService.findAllRoles();
  }

  @Get(':id')
  @RequirePermission('users:assign_role')
  @ApiOperation({
    summary: 'View one role and the permissions it grants',
    description:
      '`id` is a role UUID or its name (case-insensitive). Answers the same shape as the list, so a role editor can ' +
      'load the current values before sending a PATCH. Unknown role → 404.',
  })
  @ApiParam({ name: 'id', description: 'Role UUID or name' })
  @ApiResponse({ status: 200, description: 'The role with its permissions', type: RoleEntity })
  @ApiResponse({ status: 403, description: 'Missing users:assign_role' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async getRole(@Param('id') id: string): Promise<RoleEntity> {
    return this.identityService.findRoleById(id);
  }

  @Post()
  @RequirePermission('system:manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a role with its scope and permissions (Section 4.5)',
    description:
      'The name is stored in upper case and must be unique, ignoring case (409); the six base role names are ' +
      "reserved (400). The scope is 'platform', 'school' or 'group'. Permissions are codes from GET /permissions; " +
      'an unknown or blank code is rejected (400) and nothing is created, and `system:manage` is only accepted on a ' +
      'platform-scoped role (400 otherwise). Platform admins only.',
  })
  @ApiResponse({ status: 201, description: 'The created role with its permission codes', type: RoleEntity })
  @ApiResponse({
    status: 400,
    description:
      'Invalid name, scope or permission list, unknown/blank permission code, system:manage outside the platform ' +
      'scope, or a reserved base role name',
  })
  @ApiResponse({ status: 403, description: 'Not a platform admin (missing platform-wide system:manage)' })
  @ApiResponse({ status: 409, description: 'A role with this name already exists' })
  async createRole(
    @Body() dto: CreateRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<RoleEntity> {
    return this.identityService.createRole(dto, actor, auditContextFromRequest(req));
  }

  @Patch(':id')
  @RequirePermission('system:manage')
  @ApiOperation({
    summary: 'Edit a role and its permissions (#45)',
    description:
      'Changes the name, the scope and/or the permission set of a custom role. Every field is optional, but at ' +
      'least one must be sent (400 otherwise) and the payload is validated before anything is written.\n\n' +
      '- `permissions` takes permission **codes** (what `GET /roles` returns) and `permissionIds` permission **ids** ' +
      '(what `GET /permissions` returns); both replace the whole set, an empty array clears it, and sending both is ' +
      '400. An unknown, blank or over-long code/id is 400 and nothing is written.\n' +
      '- **Base roles cannot be edited** (400): they are the capability matrix the seed recreates.\n' +
      '- `system:manage` is only accepted on a platform-scoped role (400 otherwise), and the scope of a role that ' +
      'still has active assignments cannot change (400): `schoolsWithPermission()` treats a platform-scoped ' +
      'assignment as every school, so re-scoping an assigned role would silently widen or narrow its holders.\n' +
      '- The role, its permissions and the `updated_at` of its active assignments are written in one transaction, so ' +
      'the mobile delta sync (Section 4.7) picks the change up.\n' +
      '- Permissions are read from the database on every request, so a user holding the role is allowed or refused ' +
      'by the new set on their very next request. Recorded as `identity_access/role_updated` with the permission ' +
      'diff; a payload that changes nothing writes and audits nothing.',
  })
  @ApiParam({ name: 'id', description: 'Role UUID or name' })
  @ApiResponse({ status: 200, description: 'The updated role with its permission codes and ids', type: RoleEntity })
  @ApiResponse({
    status: 400,
    description:
      'Base role, nothing to update, both permission spellings, unknown/blank permission code or id, ' +
      'system:manage outside the platform scope, scope change on an assigned role, reserved or invalid name',
  })
  @ApiResponse({ status: 403, description: 'Not a platform admin (missing platform-wide system:manage)' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({ status: 409, description: 'A role with the new name already exists' })
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<RoleEntity> {
    return this.identityService.updateRole(id, dto, actor, auditContextFromRequest(req));
  }

  @Delete(':id')
  @RequirePermission('system:manage')
  @ApiOperation({
    summary: 'Delete an unused custom role (#46)',
    description:
      'Removes a custom role that nobody holds. `id` is a role UUID or its name (case-insensitive).\n\n' +
      '- **Base roles cannot be deleted** (400 `System base roles cannot be deleted`): the seed recreates them.\n' +
      '- **A role still assigned to users is refused** (400) with the exact count, e.g. ' +
      "`Cannot delete role 'X': still assigned to 3 user(s). Please reassign them before deleting.` — " +
      'reassign the holders first, then delete.\n' +
      '- Deleting a role also drops its permission rows and any document-access rule that granted it ' +
      '(both cascade); the count of dropped rules is recorded in the `identity_access/role_deleted` audit event.\n' +
      '- Unknown role → 404; a school-scoped `system:manage` holder (not a platform admin) → 403.',
  })
  @ApiParam({ name: 'id', description: 'Role UUID or name' })
  @ApiResponse({
    status: 200,
    description: 'The role was deleted',
    schema: { example: { success: true, message: "Role 'TEACHING_ASSISTANT' was successfully deleted" } },
  })
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
