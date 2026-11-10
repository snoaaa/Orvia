import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditContextFromRequest } from '../../audit/utils/audit-request-context.util.js';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { CreateAssignmentDto, ListAssignableRolesQueryDto, UpdateAssignmentDto } from '../dto/index.js';
import { AssignableRoleEntity, AssignmentEntity } from '../entities/index.js';
import { AssignmentsService } from '../services/assignments.service.js';

/**
 * Assignments (Sections 4.5 and 4.7): platform admins assign in every school, school admins in their own
 * school and only roles at or below their level; other roles lack users:assign_role.
 */
@ApiTags('Assignments')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Post()
  @RequirePermission('users:assign_role')
  @ApiOperation({
    summary: 'Assign a user to a school, an optional group, and a role',
    description:
      'A user has at most one assignment per school (change it with PATCH /identity/users/:id/role). The group must ' +
      'belong to the school; the user is also added to its members. The role must be at or below your own level ' +
      '(platform > school > group). Records identity_access/role_assigned. The assignment appears in GET /users/:id.',
  })
  @ApiResponse({ status: 201, description: 'The created assignment', type: AssignmentEntity })
  @ApiResponse({
    status: 400,
    description: 'Invalid body, unknown role, deactivated school, group of another school, or a group on a platform role',
  })
  @ApiResponse({
    status: 403,
    description: 'Missing permission, another school, a role above your level, or a user who outranks you',
  })
  @ApiResponse({ status: 404, description: 'User, school or group not found' })
  @ApiResponse({ status: 409, description: 'The user already has an assignment in this school' })
  async create(
    @Body() dto: CreateAssignmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<AssignmentEntity> {
    return this.assignmentsService.createAssignment(dto, actor, auditContextFromRequest(req));
  }

  @Patch(':id')
  @RequirePermission('users:assign_role')
  @ApiOperation({
    summary: "Change an assignment's role and/or group",
    description:
      'The school of an assignment cannot be changed here: only `role` and `groupId`. To move a user to another ' +
      'school, create an assignment there with POST /assignments. Re-runs the checks of POST /assignments: the new ' +
      'role must be at or below your own level, the group must belong to the assignment school, a platform role ' +
      'cannot have a group, and you cannot edit a user who outranks you. A new group moves the user from the old ' +
      'group members to the new one; `groupId: null` removes the group. Without a real change nothing is written ' +
      'and `updatedAt` stays the same; otherwise `updatedAt` moves so the next mobile sync picks it up. Records ' +
      'identity_access/assignment_updated.',
  })
  @ApiParam({ name: 'id', description: 'Assignment id (UUID)' })
  @ApiResponse({ status: 200, description: 'The assignment after the change (unchanged when nothing changed)', type: AssignmentEntity })
  @ApiResponse({
    status: 400,
    description:
      'Invalid body (empty, unknown field such as schoolId, invalid UUID), unknown role, deactivated school, ' +
      'group of another school, or a group on a platform role',
  })
  @ApiResponse({
    status: 403,
    description: 'Missing permission, another school, a role above your level, or a user who outranks you',
  })
  @ApiResponse({ status: 404, description: 'Assignment or group not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssignmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<AssignmentEntity> {
    return this.assignmentsService.updateAssignment(id, dto, actor, auditContextFromRequest(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('users:assign_role')
  @ApiOperation({
    summary: 'Remove an assignment (soft delete)',
    description:
      'Ends the link between the user and the school, group and role of this assignment. The row is kept with ' +
      '`deletedAt` set (and `updatedAt` moved) so the next mobile sync sees the removal; the access is gone on the ' +
      "user's very next request. The user also leaves the members of that school's groups. Same checks as PATCH: " +
      'your school only (platform admins: all), a role at or below your level, and not a user who outranks you. ' +
      'The last school admin of a school (a school-scoped role with users:assign_role, held by a user who is not ' +
      'suspended) cannot be removed. Removing an already removed assignment is 404. Records ' +
      'identity_access/assignment_removed.',
  })
  @ApiParam({ name: 'id', description: 'Assignment id (UUID)' })
  @ApiResponse({ status: 204, description: 'The assignment was removed' })
  @ApiResponse({ status: 400, description: 'Invalid UUID or deactivated school' })
  @ApiResponse({
    status: 403,
    description: 'Missing permission, another school, a role above your level, or a user who outranks you',
  })
  @ApiResponse({ status: 404, description: 'Assignment not found or already removed' })
  @ApiResponse({ status: 409, description: 'The last school administrator of the school cannot be removed' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.assignmentsService.removeAssignment(id, actor, auditContextFromRequest(req));
  }

  @Get('assignable-roles')
  @RequirePermission('users:assign_role')
  @ApiOperation({
    summary: 'Roles you may assign',
    description:
      'Roles at or below your own level (platform 3 > school 2 > group 1), highest first. With schoolId, only your ' +
      'roles in that school (and platform roles) count.',
  })
  @ApiResponse({ status: 200, description: 'Assignable roles', type: [AssignableRoleEntity] })
  @ApiResponse({ status: 400, description: 'Invalid query' })
  @ApiResponse({ status: 403, description: 'Missing permission or a school outside your scope' })
  async listAssignableRoles(
    @Query() query: ListAssignableRolesQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AssignableRoleEntity[]> {
    return this.assignmentsService.listAssignableRoles(actor, query.schoolId);
  }
}
