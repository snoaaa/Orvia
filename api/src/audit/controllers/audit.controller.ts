import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { QueryAuditEventsDto } from '../dto/index.js';
import { AuditEventEntity } from '../entities/index.js';
import { AuditQueryService } from '../services/audit-query.service.js';

/**
 * Read-only access to the audit trail. There is deliberately no POST/PATCH/DELETE:
 * events are written by the backend through AuditService, never by clients.
 * TODO(#13): protect with @RequirePermission('audit:read') once the guards exist.
 */
@ApiTags('Audit Trail')
@ApiBearerAuth('bearer-jwt')
@RequirePermission('audit:read')
@Controller('audit')
export class AuditController {
  constructor(private readonly auditQuery: AuditQueryService) {}

  @Get('events')
  @ApiOperation({ summary: 'List audit events, newest first' })
  @ApiResponse({ status: 200, description: 'Audit events list', type: [AuditEventEntity] })
  async getEvents(@Query() query: QueryAuditEventsDto): Promise<AuditEventEntity[]> {
    return this.auditQuery.findAll(query);
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
