import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditContextFromRequest } from '../../audit/utils/audit-request-context.util.js';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { CreateRoleDto, CreateSchoolDto, CreateUserDto, InviteUserDto, UpdateUserDto } from '../dto/index.js';
import { PermissionOverviewEntity, RoleEntity, SchoolEntity, UserEntity } from '../entities/index.js';
import { IdentityAndAccessService } from '../services/identity-and-access.service.js';

@ApiTags('Identity and Access')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@ApiResponse({ status: 403, description: 'Missing permission, suspended account, or another school' })
@Controller('identity')
export class IdentityAndAccessController {
  constructor(private readonly identityService: IdentityAndAccessService) {}

  @Get('users')
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'List users (school admins only see users of their schools)' })
  @ApiResponse({ status: 200, description: 'List of users retrieved', type: [UserEntity] })
  async getUsers(@CurrentUser() actor: AuthenticatedUser): Promise<UserEntity[]> {
    return this.identityService.findAllUsers(actor);
  }

  @Get('users/:id')
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User retrieved', type: UserEntity })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserById(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<UserEntity> {
    return this.identityService.findUserById(id, actor);
  }

  /**
   * Minimal user invitation endpoint (Issue #9).
   *
   * Creates an invited user without a password (authenticated via institutional Google OAuth).
   * Validates the email domain against the school's configured domains in `school_domains`.
   * Schools with no configured domains permit any domain.
   */
  @Post('users/invite')
  @RequirePermission('users:invite')
  @ApiOperation({
    summary: 'Invite a new user (school-domain-validated)',
    description:
      'Creates a new user with status INVITED and no password (they will authenticate via Google). ' +
      'School admins must provide a schoolId from their own assigned schools. ' +
      "The email domain is checked against the school's configured domains in school_domains. " +
      'Schools with no configured domains do NOT restrict by domain (no domain config = no restriction). ' +
      'Duplicate emails across the entire platform are rejected with 409.',
  })
  @ApiResponse({ status: 201, description: 'User invited successfully', type: UserEntity })
  @ApiResponse({ status: 400, description: 'Invalid input, unknown role, or email domain not allowed for school' })
  @ApiResponse({ status: 403, description: 'Missing permission or not authorized for school' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async inviteUser(
    @Body() dto: InviteUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<UserEntity> {
    return this.identityService.inviteUser(dto, actor, auditContextFromRequest(req));
  }

  @Post('users')
  @RequirePermission('users:invite')
  @ApiOperation({ summary: 'Create (invite) a new user; school admins must give one of their schools' })
  @ApiResponse({ status: 201, description: 'User successfully created', type: UserEntity })
  async createUser(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<UserEntity> {
    return this.identityService.createUser(dto, actor, auditContextFromRequest(req));
  }

  @Patch('users/:id')
  @RequirePermission('users:update')
  @ApiOperation({ summary: 'Update an existing user (changing the status also needs users:suspend)' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User updated', type: UserEntity })
  async updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<UserEntity> {
    return this.identityService.updateUser(id, dto, actor, auditContextFromRequest(req));
  }

  @Get('schools')
  @RequirePermission('schools:read')
  @ApiOperation({ summary: 'List schools (school admins only see their own)' })
  @ApiResponse({ status: 200, description: 'List of schools', type: [SchoolEntity] })
  async getSchools(@CurrentUser() actor: AuthenticatedUser): Promise<SchoolEntity[]> {
    const paginated = await this.identityService.findAllSchools(actor, { limit: 100 });
    return paginated.data;
  }

  @Get('schools/:id')
  @RequirePermission('schools:read')
  @ApiOperation({ summary: 'Get school by ID' })
  @ApiParam({ name: 'id', description: 'School UUID' })
  @ApiResponse({ status: 200, description: 'School retrieved', type: SchoolEntity })
  @ApiResponse({ status: 403, description: 'Forbidden: school admin cannot read another school' })
  @ApiResponse({ status: 404, description: 'School not found' })
  async getSchoolById(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SchoolEntity> {
    return this.identityService.findSchoolById(id, actor);
  }

  @Post('schools')
  @RequirePermission('schools:create')
  @ApiOperation({ summary: 'Register a new school (platform admin)' })
  @ApiResponse({ status: 201, description: 'School registered', type: SchoolEntity })
  async createSchool(
    @Body() dto: CreateSchoolDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SchoolEntity> {
    return this.identityService.createSchool(dto, actor, auditContextFromRequest(req));
  }

  @Get('roles')
  @RequirePermission('users:assign_role')
  @ApiOperation({ summary: 'List available roles' })
  @ApiResponse({ status: 200, description: 'List of roles', type: [RoleEntity] })
  async getRoles(): Promise<RoleEntity[]> {
    return this.identityService.findAllRoles();
  }

  @Post('roles')
  @RequirePermission('system:manage')
  @ApiOperation({ summary: 'Define a custom role (platform admin)' })
  @ApiResponse({ status: 201, description: 'Role created', type: RoleEntity })
  async createRole(@Body() dto: CreateRoleDto): Promise<RoleEntity> {
    return this.identityService.createRole(dto);
  }

  @Get('permissions')
  @RequirePermission('users:assign_role')
  @ApiOperation({
    summary: 'All permissions, the roles granting them, and who holds them',
    description: 'Platform admins see every holder; school admins only see holders in their own schools.',
  })
  @ApiQuery({ name: 'code', required: false, description: "Only this permission, e.g. 'users:invite'" })
  @ApiResponse({ status: 200, description: 'Permission overview', type: [PermissionOverviewEntity] })
  async getPermissions(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('code') code?: string,
  ): Promise<PermissionOverviewEntity[]> {
    return this.identityService.findPermissionOverview(actor, code);
  }
}
