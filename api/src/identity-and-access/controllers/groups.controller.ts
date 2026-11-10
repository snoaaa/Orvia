import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { CreateGroupDto } from '../dto/index.js';
import { GroupEntity } from '../entities/index.js';
import { GroupsService } from '../services/groups.service.js';

/** Groups of a school: platform admins act on every school, school admins on their own only. */
@ApiTags('Groups')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@ApiResponse({ status: 403, description: 'Missing permission (only platform and school admins) or another school' })
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  @RequirePermission('groups:read')
  @ApiOperation({
    summary: 'List groups of your school(s) (§4.5, §4.7, #89)',
    description: 'School admins only get groups belonging to their assigned schools.',
  })
  @ApiQuery({ name: 'schoolId', required: false, description: 'Filter groups by school UUID' })
  @ApiResponse({ status: 200, description: 'List of groups', type: [GroupEntity] })
  async getGroups(
    @Query('schoolId') schoolId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<GroupEntity[]> {
    return this.groupsService.findAllGroups(actor, schoolId);
  }

  @Get(':id')
  @RequirePermission('groups:read')
  @ApiOperation({
    summary: 'Get group by ID (scoped to school) (§4.5, §4.7, #89)',
    description: 'Retrieves a single group. Throws 403 if belonging to another school.',
  })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiResponse({ status: 200, description: 'The group', type: GroupEntity })
  @ApiResponse({ status: 403, description: 'Forbidden: caller lacks access to this school' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  async getGroupById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<GroupEntity> {
    return this.groupsService.findGroupById(id, actor);
  }

  @Post()
  @RequirePermission('groups:create')
  @ApiOperation({
    summary: 'Create a group in a school',
    description:
      'Creates a class, department or team. The name is unique within the school, ignoring case. ' +
      'School admins can only create groups in their own schools.',
  })
  @ApiResponse({ status: 201, description: 'The created group', type: GroupEntity })
  @ApiResponse({ status: 400, description: 'Invalid body or deactivated school' })
  @ApiResponse({ status: 404, description: 'School not found' })
  @ApiResponse({ status: 409, description: 'A group with this name already exists in the school' })
  async createGroup(@Body() dto: CreateGroupDto, @CurrentUser() actor: AuthenticatedUser): Promise<GroupEntity> {
    return this.groupsService.createGroup(dto, actor);
  }
}
