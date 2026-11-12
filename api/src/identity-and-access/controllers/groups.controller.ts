import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { CreateGroupDto, ListGroupsQueryDto, UpdateGroupDto } from '../dto/index.js';
import { GroupDetailEntity, GroupEntity, PaginatedGroupsEntity } from '../entities/index.js';
import { GroupsService } from '../services/groups.service.js';

/**
 * Groups of a school: platform admins act on every school, school admins on their own only.
 * Content managers can list and view the groups of their school, not change them.
 */
@ApiTags('Groups')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@ApiResponse({ status: 403, description: 'Missing permission or another school' })
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

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

  @Get()
  @RequirePermission('groups:read')
  @ApiOperation({
    summary: 'List groups with filters and pagination',
    description:
      'Filter by school, type and part of the name. Platform admins see every school; school admins and content ' +
      'managers only their own (filtering on another school returns 403). Each group carries its member count.',
  })
  @ApiResponse({ status: 200, description: 'One page of groups', type: PaginatedGroupsEntity })
  @ApiResponse({ status: 400, description: 'Invalid query parameter' })
  async listGroups(
    @Query() query: ListGroupsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedGroupsEntity> {
    return this.groupsService.listGroups(actor, query);
  }

  @Get(':id')
  @RequirePermission('groups:read')
  @ApiOperation({ summary: 'View a group with its member count' })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiResponse({ status: 200, description: 'The group', type: GroupDetailEntity })
  @ApiResponse({ status: 400, description: 'id is not a valid UUID' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  async getGroup(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<GroupDetailEntity> {
    return this.groupsService.getGroup(id, actor);
  }

  @Patch(':id')
  @RequirePermission('groups:update')
  @ApiOperation({
    summary: "Update a group's name or type",
    description:
      'The name stays unique within the school. The school cannot be changed. Content managers cannot update groups.',
  })
  @ApiParam({ name: 'id', description: 'Group UUID' })
  @ApiResponse({ status: 200, description: 'The updated group', type: GroupDetailEntity })
  @ApiResponse({ status: 400, description: 'Invalid id or body, nothing to update, or deactivated school' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  @ApiResponse({ status: 409, description: 'A group with this name already exists in the school' })
  async updateGroup(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateGroupDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<GroupDetailEntity> {
    return this.groupsService.updateGroup(id, dto, actor);
  }
}
