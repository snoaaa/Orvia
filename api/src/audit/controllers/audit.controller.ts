import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateAuditEventDto, QueryAuditEventsDto } from '../dto/index.js';
import { AuditEventEntity } from '../entities/index.js';
import { AuditService } from '../services/audit.service.js';

@ApiTags('Audit Trail')
@ApiBearerAuth('bearer-jwt')
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('events')
  @ApiOperation({ summary: 'Query append-only audit trail logs' })
  @ApiResponse({ status: 200, description: 'Audit events list', type: [AuditEventEntity] })
  async getEvents(@Query() query: QueryAuditEventsDto): Promise<AuditEventEntity[]> {
    return this.auditService.findAll(query);
  }

  @Post('events')
  @ApiOperation({ summary: 'Append a verified event to the audit trail' })
  @ApiResponse({ status: 201, description: 'Audit event appended', type: AuditEventEntity })
  async createEvent(@Body() dto: CreateAuditEventDto): Promise<AuditEventEntity> {
    return this.auditService.logEvent(dto);
  }
}
