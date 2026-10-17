import { ApiProperty } from '@nestjs/swagger';

export class RagRequestMetricEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174030', description: 'Metric UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174021', description: 'Message UUID' })
  messageId: string;

  @ApiProperty({ example: 'gpt-4o-mini', description: 'Model used' })
  modelUsed: string;

  @ApiProperty({ example: 1250, description: 'Total round-trip latency in ms' })
  latencyTotalMs: number;

  @ApiProperty({ example: 210, description: 'Vector retrieval latency in ms' })
  retrievalMs: number;

  @ApiProperty({ example: 95, description: 'Reranker latency in ms' })
  rerankMs: number;

  @ApiProperty({ example: 945, description: 'LLM generation latency in ms' })
  generationMs: number;

  @ApiProperty({ example: 820, description: 'Prompt tokens consumed' })
  tokensIn: number;

  @ApiProperty({ example: 180, description: 'Completion tokens generated' })
  tokensOut: number;

  @ApiProperty({ example: 0.00142, description: 'Estimated dollar cost' })
  cost: number;

  @ApiProperty({ example: 15, description: 'Candidate chunks retrieved' })
  chunksRetrieved: number;

  @ApiProperty({ example: 4, description: 'Top chunks passed into prompt' })
  chunksUsed: number;

  @ApiProperty({ example: 3, description: 'Number of verified valid citations' })
  citationsValid: number;

  @ApiProperty({ example: 0, description: 'Number of invalid/hallucinated citations' })
  citationsInvalid: number;

  @ApiProperty({ example: false, description: 'Whether knowledge base had insufficient evidence' })
  insufficientEvidence: boolean;

  @ApiProperty({ example: 'success', description: 'Execution status (success, fallback, timeout, error)' })
  status: string;

  @ApiProperty({ example: null, required: false, description: 'Error code if failed' })
  errorCode?: string | null;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<RagRequestMetricEntity>) {
    Object.assign(this, partial);
  }
}
