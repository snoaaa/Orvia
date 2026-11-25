import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditContextFromRequest } from '../../audit/utils/audit-request-context.util.js';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { AddSchoolDomainDto } from '../dto/index.js';
import { SchoolDomainEntity } from '../entities/index.js';
import { SchoolDomainsService } from '../services/school-domains.service.js';

/**
 * Allowed email domains of a school (#32, Section 4.6): who may be invited and sign in with Google.
 * Platform admins act on every school, school admins on their own only.
 */
@ApiTags('Schools')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@ApiResponse({ status: 403, description: 'Missing permission or another school' })
@ApiParam({ name: 'id', description: 'School UUID' })
@Controller('schools/:id/domains')
export class SchoolDomainsController {
  constructor(private readonly schoolDomainsService: SchoolDomainsService) {}

  @Get()
  @RequirePermission('schools:read')
  @ApiOperation({ summary: "List a school's allowed email domains, with their ids" })
  @ApiResponse({ status: 200, type: [SchoolDomainEntity] })
  @ApiResponse({ status: 400, description: 'Invalid school id' })
  @ApiResponse({ status: 404, description: 'School not found' })
  async listDomains(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SchoolDomainEntity[]> {
    return this.schoolDomainsService.listDomains(id, actor);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('schools:update')
  @ApiOperation({
    summary: 'Allow an email domain for a school',
    description:
      'The domain is trimmed, lowercased and stripped of a leading "@"; a shared suffix such as edu.cm is refused. ' +
      'It cannot belong to two schools, and neither can its parent or subdomains (login accepts subdomains). ' +
      'A subdomain of a domain this school already has is redundant (409). Applies to the next invitation and login.',
  })
  @ApiResponse({ status: 201, description: 'Domain allowed', type: SchoolDomainEntity })
  @ApiResponse({ status: 400, description: 'Invalid school id or domain format' })
  @ApiResponse({ status: 404, description: 'School not found' })
  @ApiResponse({ status: 409, description: 'Already allowed or covered for this school, or overlapping a domain of another school' })
  async addDomain(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddSchoolDomainDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<SchoolDomainEntity> {
    return this.schoolDomainsService.addDomain(id, dto, actor, auditContextFromRequest(req));
  }

  @Delete(':domainId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('schools:update')
  @ApiOperation({
    summary: 'Remove an allowed email domain from a school',
    description:
      'Applies to the next invitation and login. Removing the last domain lifts the restriction: a school ' +
      'without domains accepts any email domain.',
  })
  @ApiParam({ name: 'domainId', description: 'Domain UUID (from GET /schools/{id}/domains)' })
  @ApiResponse({ status: 204, description: 'Domain removed' })
  @ApiResponse({ status: 400, description: 'Invalid school or domain id' })
  @ApiResponse({ status: 404, description: 'School not found, or the domain is not one of this school' })
  async removeDomain(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('domainId', new ParseUUIDPipe()) domainId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.schoolDomainsService.removeDomain(id, domainId, actor, auditContextFromRequest(req));
  }
}
