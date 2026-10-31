import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditContextFromRequest } from '../../audit/utils/audit-request-context.util.js';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { CreateSchoolDto, ListSchoolsQueryDto, UpdateSchoolDto } from '../dto/index.js';
import { PaginatedSchoolsEntity, SchoolEntity } from '../entities/index.js';
import { IdentityAndAccessService } from '../services/identity-and-access.service.js';

@ApiTags('Schools')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@ApiResponse({ status: 403, description: 'Missing required permission or unauthorized for school' })
@Controller('schools')
export class SchoolsController {
  constructor(private readonly identityService: IdentityAndAccessService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('schools:create')
  @ApiOperation({
    summary: 'Create a new school (platform admin)',
    description:
      'Creates a new educational institution with status active (Section 4.5). ' +
      'Only platform administrators holding the schools:create permission may create schools. ' +
      'Validates required fields (name) and enforces unique school name. Duplicate names return 409 Conflict.',
  })
  @ApiResponse({
    status: 201,
    description: 'School created successfully',
    type: SchoolEntity,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed: required fields missing, empty name, or invalid settings format',
  })
  @ApiResponse({
    status: 409,
    description: 'A school with this name already exists or domain conflict',
  })
  async createSchool(
    @Body() dto: CreateSchoolDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SchoolEntity> {
    return this.identityService.createSchool(dto, actor, auditContextFromRequest(req));
  }

  @Get()
  @RequirePermission('schools:read')
  @ApiOperation({
    summary: 'List schools with pagination and status filter (Section 4.5)',
    description:
      'Retrieves educational institutions (Issue #29). ' +
      'Platform administrators see all schools; school administrators only see their own assigned school(s). ' +
      'Supports pagination (page, limit) and filtering by status and name search.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of schools retrieved',
    type: PaginatedSchoolsEntity,
  })
  async getSchools(
    @Query() query: ListSchoolsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedSchoolsEntity> {
    return this.identityService.findAllSchools(actor, query);
  }

  @Get(':id')
  @RequirePermission('schools:read')
  @ApiOperation({
    summary: 'Get school by ID (Section 4.5)',
    description:
      'Retrieves details for a specific school (Issue #29). ' +
      'Platform administrators can read any school; school administrators can only read their own assigned school ' +
      '(returns 403 if attempting to access another school).',
  })
  @ApiParam({ name: 'id', description: 'School UUID' })
  @ApiResponse({ status: 200, description: 'School retrieved successfully', type: SchoolEntity })
  @ApiResponse({ status: 403, description: 'Forbidden: school admin cannot read another school' })
  @ApiResponse({ status: 404, description: 'School not found' })
  async getSchoolById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SchoolEntity> {
    return this.identityService.findSchoolById(id, actor);
  }

  @Patch(':id')
  @RequirePermission('schools:update')
  @ApiOperation({
    summary: 'Update school details and settings (Section 4.5)',
    description:
      'Updates school parameters (name, settings) (Issue #30). ' +
      'Platform administrators can edit any school; school administrators can only edit their own school. ' +
      'Enforces unique school name and validates settings object.',
  })
  @ApiParam({ name: 'id', description: 'School UUID' })
  @ApiResponse({ status: 200, description: 'School updated successfully', type: SchoolEntity })
  @ApiResponse({ status: 400, description: 'Validation failed: invalid settings format or empty name' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Forbidden: school admin cannot edit another school' })
  @ApiResponse({ status: 404, description: 'School not found' })
  @ApiResponse({ status: 409, description: 'A school with this name already exists' })
  async updateSchool(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateSchoolDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SchoolEntity> {
    return this.identityService.updateSchool(id, dto, actor, auditContextFromRequest(req));
  }
}
