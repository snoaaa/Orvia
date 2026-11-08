import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { OverviewQueryDto } from '../dto/overview-query.dto.js';
import { OverviewEntity } from '../entities/overview.entity.js';
import { OverviewService } from '../services/overview.service.js';

@ApiTags('Overview')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@Controller('admin')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get('overview')
  @RequirePermission('users:read')
  @ApiOperation({
    summary: 'Dashboard overview: counts, time series, top spaces and recent activity',
    description:
      'One round trip for the whole dashboard. Every number is scoped to the caller (platform admins see ' +
      'everything, school admins only their schools). Each section appears only if the caller may read it: ' +
      'users (users:read), schools (schools:read), sessions (users:suspend), documents (documents:read), ' +
      'spaces (spaces:read), series and recent activity (audit:read).',
  })
  @ApiQuery({ name: 'range', required: false, enum: ['7d', '30d', '12m'], description: 'Series window and bucket size' })
  @ApiResponse({ status: 200, description: 'Overview for the current admin', type: OverviewEntity })
  async getOverview(
    @Query() query: OverviewQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<OverviewEntity> {
    return this.overview.getOverview(actor, query.range ?? '7d');
  }
}
