import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../auth/decorators/auth.decorators.js';
import { CreateRagMetricDto, QueryRagMetricsDto } from '../dto/index.js';
import { RagRequestMetricEntity } from '../entities/index.js';
import { RagPerformanceService } from '../services/rag-performance.service.js';

@ApiTags('RAG Performance')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@ApiResponse({ status: 403, description: 'Missing permission or suspended account' })
@Controller('rag-performance')
export class RagPerformanceController {
  constructor(private readonly ragService: RagPerformanceService) {}

  @Get('metrics')
  @RequirePermission('metrics:view')
  @ApiOperation({ summary: 'List RAG performance and latency telemetry' })
  @ApiResponse({ status: 200, description: 'RAG metrics list', type: [RagRequestMetricEntity] })
  async getMetrics(@Query() query: QueryRagMetricsDto): Promise<RagRequestMetricEntity[]> {
    return this.ragService.findAllMetrics(query);
  }

  @Post('metrics')
  @RequirePermission('metrics:view')
  @ApiOperation({ summary: 'Record telemetry for a RAG execution' })
  @ApiResponse({ status: 201, description: 'Metric recorded', type: RagRequestMetricEntity })
  async createMetric(@Body() dto: CreateRagMetricDto): Promise<RagRequestMetricEntity> {
    return this.ragService.recordMetric(dto);
  }
}
