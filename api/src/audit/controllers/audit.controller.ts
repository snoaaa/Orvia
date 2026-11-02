import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { QueryAuditEventsDto } from '../dto/index.js';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { AuditEventEntity } from '../entities/index.js';
import { AuditQueryService } from '../services/audit-query.service.js';

/**
 * Read-only access to the audit trail. There is deliberately no POST/PATCH/DELETE:
 * events are written by the backend through AuditService, never by clients.
 */
@ApiTags('Audit Trail')
@ApiBearerAuth('bearer-jwt')
@RequirePermission('audit:read')
@Controller('audit')
export class AuditController {
  constructor(private readonly auditQuery: AuditQueryService) {}

  @Get('events')
  @ApiOperation({
    summary: 'List audit events, newest first (school-scoped)',
    description:
      'A platform administrator reads every event; a school administrator only reads events whose ' +
      'school is one of their own. Events without a school (platform actions, unknown-user login ' +
      'failures) are only visible to platform administrators.',
  })
  @ApiResponse({ status: 200, description: 'Audit events list', type: [AuditEventEntity] })
  async getEvents(
    @Query() query: QueryAuditEventsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AuditEventEntity[]> {
    return this.auditQuery.findAll(query, actor);
  }

  @Get('verify')
  @ApiOperation({
    summary: 'Verify the audit hash chain',
    description:
      'Recomputes every hash in insertion order. `valid: false` means a row was edited, removed or inserted outside the application.',
  })
  @ApiResponse({ status: 200, description: 'Verification result' })
  async verify() {
    return this.auditQuery.verifyChain();
  }
}
