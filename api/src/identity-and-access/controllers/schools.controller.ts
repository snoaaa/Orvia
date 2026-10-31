import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditContextFromRequest } from '../../audit/utils/audit-request-context.util.js';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { CreateSchoolDto } from '../dto/index.js';
import { SchoolEntity } from '../entities/index.js';
import { IdentityAndAccessService } from '../services/identity-and-access.service.js';

@ApiTags('Schools')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@ApiResponse({ status: 403, description: 'Missing permission: only platform administrators can create schools' })
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
}

