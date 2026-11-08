import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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
