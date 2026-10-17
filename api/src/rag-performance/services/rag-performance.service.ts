import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateRagMetricDto, QueryRagMetricsDto } from '../dto/index.js';
import { RagRequestMetricEntity } from '../entities/index.js';
import { RagMetricMapper } from '../mappers/index.js';

@Injectable()
export class RagPerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllMetrics(query?: QueryRagMetricsDto): Promise<RagRequestMetricEntity[]> {
    const sample = new RagRequestMetricEntity({
      id: randomUUID(),
      messageId: randomUUID(),
      modelUsed: query?.model || 'gpt-4o-mini',
      latencyTotalMs: 1150,
      retrievalMs: 180,
      rerankMs: 65,
      generationMs: 905,
      tokensIn: 720,
      tokensOut: 160,
      cost: 0.00115,
      chunksRetrieved: 12,
      chunksUsed: 3,
      citationsValid: 3,
      citationsInvalid: 0,
      insufficientEvidence: false,
      status: query?.status || 'success',
      errorCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return [sample];
  }

  async recordMetric(dto: CreateRagMetricDto): Promise<RagRequestMetricEntity> {
    const id = randomUUID();
    return RagMetricMapper.fromDtoToCreateInput(dto, id);
  }
}
