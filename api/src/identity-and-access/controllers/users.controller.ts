import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { SearchUsersQueryDto } from '../dto/index.js';
import { PaginatedUserListEntity, UserDetailEntity } from '../entities/index.js';
import { IdentityAndAccessService } from '../services/identity-and-access.service.js';

/**
 * User management for administrators (Section 4.5): platform admins act on every school,
 * school admins on their own school only; other roles lack users:* permissions.
 */
@ApiTags('Users')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@ApiResponse({ status: 403, description: 'Missing permission (only platform and school admins) or another school' })
@Controller('users')
export class UsersController {
  constructor(private readonly identityService: IdentityAndAccessService) {}

  @Get()
  @RequirePermission('users:read')
  @ApiOperation({
    summary: 'Search and list users with filters and pagination',
    description:
      'Search by name or email; filter by school, role, group and status (combinable: school, role and group must ' +
      'match the same assignment). School admins only see users of their own schools and only those assignments; ' +
      'filtering on another school or its groups returns 403. Never returns password hashes or tokens.',
  })
  @ApiResponse({ status: 200, description: 'One page of users', type: PaginatedUserListEntity })
  @ApiResponse({ status: 400, description: 'Invalid query parameter or unknown role' })
  @ApiResponse({ status: 404, description: 'groupId does not exist' })
  async listUsers(
    @Query() query: SearchUsersQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedUserListEntity> {
    return this.identityService.listUsers(actor, query);
  }

  @Get(':id')
  @RequirePermission('users:read')
  @ApiOperation({
    summary: "View a user's details",
    description:
      'Profile, status, assignments, groups, and active sessions with their devices. School admins only get users of ' +
      'their own schools (403 otherwise) and only those assignments and groups. Never returns password hashes or tokens.',
  })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'The user', type: UserDetailEntity })
  @ApiResponse({ status: 400, description: 'id is not a valid UUID' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUser(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserDetailEntity> {
    return this.identityService.getUserDetail(id, actor);
  }
}
