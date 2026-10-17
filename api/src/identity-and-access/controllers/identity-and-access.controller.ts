import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateRoleDto, CreateSchoolDto, CreateUserDto, UpdateUserDto } from '../dto/index.js';
import { RoleEntity, SchoolEntity, UserEntity } from '../entities/index.js';
import { IdentityAndAccessService } from '../services/identity-and-access.service.js';

@ApiTags('Identity and Access')
@Controller('identity')
export class IdentityAndAccessController {
  constructor(private readonly identityService: IdentityAndAccessService) {}

  @Get('users')
  @ApiOperation({ summary: 'List all users' })
  @ApiResponse({ status: 200, description: 'List of users retrieved', type: [UserEntity] })
  async getUsers(): Promise<UserEntity[]> {
    return this.identityService.findAllUsers();
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User retrieved', type: UserEntity })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserById(@Param('id') id: string): Promise<UserEntity> {
    return this.identityService.findUserById(id);
  }

  @Post('users')
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ status: 201, description: 'User successfully created', type: UserEntity })
  async createUser(@Body() dto: CreateUserDto): Promise<UserEntity> {
    return this.identityService.createUser(dto);
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Update an existing user' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User updated', type: UserEntity })
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto): Promise<UserEntity> {
    return this.identityService.updateUser(id, dto);
  }

  @Get('schools')
  @ApiOperation({ summary: 'List all schools' })
  @ApiResponse({ status: 200, description: 'List of schools', type: [SchoolEntity] })
  async getSchools(): Promise<SchoolEntity[]> {
    return this.identityService.findAllSchools();
  }

  @Post('schools')
  @ApiOperation({ summary: 'Register a new school' })
  @ApiResponse({ status: 201, description: 'School registered', type: SchoolEntity })
  async createSchool(@Body() dto: CreateSchoolDto): Promise<SchoolEntity> {
    return this.identityService.createSchool(dto);
  }

  @Get('roles')
  @ApiOperation({ summary: 'List available roles' })
  @ApiResponse({ status: 200, description: 'List of roles', type: [RoleEntity] })
  async getRoles(): Promise<RoleEntity[]> {
    return this.identityService.findAllRoles();
  }

  @Post('roles')
  @ApiOperation({ summary: 'Define a custom role' })
  @ApiResponse({ status: 201, description: 'Role created', type: RoleEntity })
  async createRole(@Body() dto: CreateRoleDto): Promise<RoleEntity> {
    return this.identityService.createRole(dto);
  }
}
