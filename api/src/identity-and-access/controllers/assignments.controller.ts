import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditContextFromRequest } from '../../audit/utils/audit-request-context.util.js';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { CreateAssignmentDto, ListAssignableRolesQueryDto } from '../dto/index.js';
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
