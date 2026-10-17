import { RagRequestMetricEntity } from '../entities/rag-request-metric.entity.js';
import type { CreateRagMetricDto } from '../dto/create-rag-metric.dto.js';

export class RagMetricMapper {
  static toEntity(raw: Partial<RagRequestMetricEntity>): RagRequestMetricEntity {
    return new RagRequestMetricEntity({
      id: raw.id || '',
      messageId: raw.messageId || '',
      modelUsed: raw.modelUsed || 'default',
      latencyTotalMs: raw.latencyTotalMs ?? 0,
      retrievalMs: raw.retrievalMs ?? 0,
      rerankMs: raw.rerankMs ?? 0,
      generationMs: raw.generationMs ?? 0,
      tokensIn: raw.tokensIn ?? 0,
      tokensOut: raw.tokensOut ?? 0,
      cost: raw.cost ?? 0,
      chunksRetrieved: raw.chunksRetrieved ?? 0,
      chunksUsed: raw.chunksUsed ?? 0,
      citationsValid: raw.citationsValid ?? 0,
      citationsInvalid: raw.citationsInvalid ?? 0,
      insufficientEvidence: Boolean(raw.insufficientEvidence),
      status: raw.status || 'success',
      errorCode: raw.errorCode ?? null,
      createdAt: raw.createdAt || new Date(),
      updatedAt: raw.updatedAt || new Date(),
    });
  }

  static fromDtoToCreateInput(dto: CreateRagMetricDto, id: string): RagRequestMetricEntity {
    return new RagRequestMetricEntity({
      id,
      messageId: dto.messageId,
      modelUsed: dto.modelUsed,
      latencyTotalMs: dto.latencyTotalMs,
      retrievalMs: dto.retrievalMs ?? 0,
      rerankMs: dto.rerankMs ?? 0,
      generationMs: dto.generationMs ?? 0,
      tokensIn: dto.tokensIn ?? 0,
      tokensOut: dto.tokensOut ?? 0,
      cost: dto.cost ?? 0,
      chunksRetrieved: dto.chunksRetrieved ?? 0,
      chunksUsed: dto.chunksUsed ?? 0,
      citationsValid: dto.citationsValid ?? 0,
      citationsInvalid: dto.citationsInvalid ?? 0,
      insufficientEvidence: dto.insufficientEvidence ?? false,
      status: dto.status || 'success',
      errorCode: dto.errorCode ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
