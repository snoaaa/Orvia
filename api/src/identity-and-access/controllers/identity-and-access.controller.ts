import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditContextFromRequest } from '../../audit/utils/audit-request-context.util.js';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { AssignRoleDto, CreateRoleDto, UpdateRoleDto, CreateSchoolDto, UpdateSchoolDto, GrantDocumentManagementDto, ListSchoolsQueryDto, ListUsersQueryDto, CreateUserDto, InviteUserDto, QueryPermissionOverviewDto, UpdateUserDto } from '../dto/index.js';
import { PaginatedSchoolsEntity, PaginatedUsersEntity, PermissionOverviewEntity, RoleEntity, SchoolEntity, UserEntity } from '../entities/index.js';
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
  @ApiOperation({
    summary: 'List users, paginated and filterable (school admins only see users of their schools)',
    description:
      'Same page/limit contract as GET /schools: page defaults to 1, limit to 10 and is capped at 100. ' +
      'Filters: status (INVITED/ACTIVE/SUSPENDED), search (email or full name) and sortBy/sortOrder. ' +
      'Returns { data, total, page, limit, totalPages } — `total` is the count after filtering, ' +
      'so one call per status gives the dashboard counters.',
  })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (minimum 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (1-100)' })
  @ApiQuery({ name: 'status', required: false, enum: ['INVITED', 'ACTIVE', 'SUSPENDED'], description: 'Filter by account status' })
  @ApiQuery({ name: 'search', required: false, description: 'Match on email or full name' })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'email', 'fullName', 'status'], description: 'Column to order by' })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'], description: 'Sort direction' })
  @ApiResponse({ status: 200, description: 'Paginated list of users retrieved', type: PaginatedUsersEntity })
  async getUsers(
    @Query() query: ListUsersQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedUsersEntity> {
    return this.identityService.listUsers(actor, query);
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
  @ApiOperation({
    summary: 'Update an existing user (changing the status also needs users:suspend)',
    description: 'For profile edits, use PATCH /users/{id}, which replaces this route.',
  })
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

  @Patch('users/:id/role')
  @RequirePermission('users:assign_role')
  @ApiOperation({
    summary: "Create or replace a user's role in one school (role reassignment)",
    description:
      'School-scoped admins may only assign roles inside their own school(s); a platform-scoped role ' +
      'requires platform-wide users:assign_role. Re-assigning the role already held is a no-op. ' +
      'Records identity_access/role_assigned with the previous role.',
  })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Role assigned', type: UserEntity })
  @ApiResponse({ status: 400, description: 'Unknown role' })
  @ApiResponse({
    status: 403,
    description: 'Missing permission, another school, or a platform role without platform rights',
  })
  @ApiResponse({ status: 404, description: 'User or school not found' })
  async assignRole(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<UserEntity> {
    return this.identityService.assignRole(id, dto, actor, auditContextFromRequest(req));
  }

  @Post('users/:id/document-management')
  @RequirePermission('users:assign_role')
  @ApiOperation({
    summary: 'Grant document-management rights to a staff member (§4.5, #88)',
    description:
      'Turns a staff member into a content manager for their school(s). ' +
      'Platform admins can grant for any staff member of any school. ' +
      'School admins can only grant for staff of their own school. ' +
      'Students can never receive this permission. ' +
      'Records immutable hash-chained audit events.',
  })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Document management rights granted', type: UserEntity })
  @ApiResponse({ status: 400, description: 'Student account or invalid payload' })
  @ApiResponse({ status: 403, description: 'Forbidden: school admin cannot grant outside their school' })
  @ApiResponse({ status: 404, description: 'User or school not found' })
  async grantDocumentManagement(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GrantDocumentManagementDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<UserEntity> {
    const auditContext = auditContextFromRequest(req);
    if (dto.granted === false) {
      return this.identityService.revokeDocumentManagement(id, dto.schoolId, actor, auditContext);
    }
    return this.identityService.grantDocumentManagement(id, dto.schoolId, actor, auditContext);
  }

  @Patch('users/:id/document-management')
  @RequirePermission('users:assign_role')
  @ApiOperation({
    summary: 'Grant or revoke document-management rights for a staff member (§4.5, #88)',
    description: 'Updates document-management rights for a staff member in a school.',
  })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Document management rights updated', type: UserEntity })
  @ApiResponse({ status: 400, description: 'Student account or invalid payload' })
  @ApiResponse({ status: 403, description: 'Forbidden: school admin cannot modify outside their school' })
  @ApiResponse({ status: 404, description: 'User or school not found' })
  async updateDocumentManagement(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GrantDocumentManagementDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<UserEntity> {
    const auditContext = auditContextFromRequest(req);
    if (dto.granted === false) {
      return this.identityService.revokeDocumentManagement(id, dto.schoolId, actor, auditContext);
    }
    return this.identityService.grantDocumentManagement(id, dto.schoolId, actor, auditContext);
  }

  @Delete('users/:id/document-management')
  @RequirePermission('users:assign_role')
  @ApiOperation({
    summary: 'Revoke document-management rights from a staff member (§4.5, #88)',
    description: 'Revokes document-management rights from a staff member for the specified school.',
  })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiQuery({ name: 'schoolId', description: 'School UUID', required: true })
  @ApiResponse({ status: 200, description: 'Document management rights revoked', type: UserEntity })
  @ApiResponse({ status: 403, description: 'Forbidden: school admin cannot revoke outside their school' })
  @ApiResponse({ status: 404, description: 'User or school not found' })
  async revokeDocumentManagement(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('schoolId') schoolId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<UserEntity> {
    return this.identityService.revokeDocumentManagement(id, schoolId, actor, auditContextFromRequest(req));
  }

  @Get('schools')
  @RequirePermission('schools:read')
  @ApiOperation({
    summary: 'List schools, paginated (school admins only see their own)',
    description:
      'Same contract as GET /schools: page defaults to 1, limit to 10 and is capped at 100. ' +
      'Returns { data, total, page, limit, totalPages }.',
  })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (minimum 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (1-100)' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status (e.g. active, deactivated)' })
  @ApiQuery({ name: 'search', required: false, description: 'Search schools by name' })
  @ApiResponse({ status: 200, description: 'Paginated list of schools retrieved', type: PaginatedSchoolsEntity })
  async getSchools(
    @Query() query: ListSchoolsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedSchoolsEntity> {
    return this.identityService.findAllSchools(actor, query);
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

  @Patch('schools/:id')
  @RequirePermission('schools:update')
  @ApiOperation({ summary: 'Update an existing school (platform admin or assigned school admin)' })
  @ApiParam({ name: 'id', description: 'School UUID' })
  @ApiResponse({ status: 200, description: 'School updated', type: SchoolEntity })
  async updateSchool(
    @Param('id') id: string,
    @Body() dto: UpdateSchoolDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SchoolEntity> {
    return this.identityService.updateSchool(id, dto, actor, auditContextFromRequest(req));
  }

  @Patch('schools/:id/deactivate')
  @RequirePermission('schools:delete')
  @ApiOperation({ summary: 'Deactivate a school (platform admin)' })
  @ApiParam({ name: 'id', description: 'School UUID' })
  @ApiResponse({ status: 200, description: 'School deactivated', type: SchoolEntity })
  async deactivateSchool(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SchoolEntity> {
    return this.identityService.deactivateSchool(id, actor, auditContextFromRequest(req));
  }

  @Patch('schools/:id/reactivate')
  @RequirePermission('schools:delete')
  @ApiOperation({ summary: 'Reactivate a school (platform admin)' })
  @ApiParam({ name: 'id', description: 'School UUID' })
  @ApiResponse({ status: 200, description: 'School reactivated', type: SchoolEntity })
  async reactivateSchool(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SchoolEntity> {
    return this.identityService.reactivateSchool(id, actor, auditContextFromRequest(req));
  }

  @Get('roles')
  @RequirePermission('users:assign_role')
  @ApiOperation({ summary: 'List available roles with permissions and assignment counts' })
  @ApiResponse({ status: 200, description: 'List of roles', type: [RoleEntity] })
  async getRoles(): Promise<RoleEntity[]> {
    return this.identityService.findAllRoles();
  }

  @Get('roles/:id')
  @RequirePermission('users:assign_role')
  @ApiOperation({ summary: 'Get role by ID or name with permissions' })
  @ApiParam({ name: 'id', description: 'Role UUID or name' })
  @ApiResponse({ status: 200, description: 'Role details', type: RoleEntity })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async getRoleById(@Param('id') id: string): Promise<RoleEntity> {
    return this.identityService.findRoleById(id);
  }

  @Post('roles')
  @RequirePermission('system:manage')
  @ApiOperation({
    summary: 'Define a custom role (platform admin)',
    description: 'Older path of POST /roles, same rules and answers.',
  })
  @ApiResponse({ status: 201, description: 'Role created', type: RoleEntity })
  @ApiResponse({ status: 400, description: 'Reserved base role name, unknown permission code or invalid payload' })
  @ApiResponse({ status: 403, description: 'Not a platform admin (missing platform-wide system:manage)' })
  @ApiResponse({ status: 409, description: 'Role already exists' })
  async createRole(@Body() dto: CreateRoleDto, @CurrentUser() actor: AuthenticatedUser): Promise<RoleEntity> {
    return this.identityService.createRole(dto, actor);
  }

  @Patch('roles/:id')
  @RequirePermission('system:manage')
  @ApiOperation({ summary: 'Update a custom role and its permissions (platform admin)' })
  @ApiParam({ name: 'id', description: 'Role UUID or name' })
  @ApiResponse({ status: 200, description: 'Role updated', type: RoleEntity })
  @ApiResponse({ status: 400, description: 'Base roles cannot be edited or invalid payload' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({ status: 409, description: 'Role name already taken' })
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleEntity> {
    return this.identityService.updateRole(id, dto);
  }

  @Delete('roles/:id')
  @RequirePermission('system:manage')
  @ApiOperation({ summary: 'Delete a custom role (blocked if base role or still assigned to users)' })
  @ApiParam({ name: 'id', description: 'Role UUID or name' })
  @ApiResponse({ status: 200, description: 'Role deleted' })
  @ApiResponse({ status: 400, description: 'Cannot delete base role or role currently assigned to users' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async deleteRole(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    return this.identityService.deleteRole(id);
  }

  @Get('permissions')
  @RequirePermission('users:assign_role')
  @ApiOperation({
    summary: 'All permissions, the roles granting them, and how many users hold them',
    description:
      'Without `code`: one row per permission with its roles and a holder count (bounded, 42 rows today). ' +
      'With `code`: that permission plus its holders, grouped per user and school (a person holding it ' +
      'through several roles appears once, listing every role), capped by `limit`. ' +
      'Platform admins see every holder; school admins only holders in their own schools.',
  })
  @ApiQuery({ name: 'code', required: false, description: "Drill into one permission, e.g. 'users:invite'" })
  @ApiQuery({ name: 'limit', required: false, description: 'Max holders returned with `code` (1-200, default 50)' })
  @ApiResponse({ status: 200, description: 'Permission overview', type: [PermissionOverviewEntity] })
  @ApiResponse({ status: 404, description: 'Unknown permission code' })
  async getPermissions(
    @Query() query: QueryPermissionOverviewDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PermissionOverviewEntity[]> {
    return this.identityService.findPermissionOverview(actor, query);
  }
}
