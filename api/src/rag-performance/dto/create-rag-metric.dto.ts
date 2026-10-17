import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateRagMetricDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174021', description: 'Message UUID' })
  @IsString()
  @IsNotEmpty()
  messageId: string;

  @ApiProperty({ example: 'gpt-4o-mini', description: 'Model identifier' })
  @IsString()
  @IsNotEmpty()
  modelUsed: string;

  @ApiProperty({ example: 1200, description: 'Total latency (ms)' })
  @IsNumber()
  latencyTotalMs: number;

  @ApiPropertyOptional({ example: 180, description: 'Vector retrieval latency (ms)' })
  @IsNumber()
  @IsOptional()
  retrievalMs?: number;

  @ApiPropertyOptional({ example: 70, description: 'Reranker latency (ms)' })
  @IsNumber()
  @IsOptional()
  rerankMs?: number;

  @ApiPropertyOptional({ example: 950, description: 'LLM generation latency (ms)' })
  @IsNumber()
  @IsOptional()
  generationMs?: number;

  @ApiPropertyOptional({ example: 650, description: 'Tokens in' })
  @IsNumber()
  @IsOptional()
  tokensIn?: number;

  @ApiPropertyOptional({ example: 140, description: 'Tokens out' })
  @IsNumber()
  @IsOptional()
  tokensOut?: number;

  @ApiPropertyOptional({ example: 0.0012, description: 'Estimated query cost' })
  @IsNumber()
  @IsOptional()
  cost?: number;

  @ApiPropertyOptional({ example: 10, description: 'Chunks retrieved' })
  @IsNumber()
  @IsOptional()
  chunksRetrieved?: number;

  @ApiPropertyOptional({ example: 3, description: 'Chunks used in generation' })
  @IsNumber()
  @IsOptional()
  chunksUsed?: number;

  @ApiPropertyOptional({ example: 3, description: 'Valid citations' })
  @IsNumber()
  @IsOptional()
  citationsValid?: number;

  @ApiPropertyOptional({ example: 0, description: 'Invalid citations' })
  @IsNumber()
  @IsOptional()
  citationsInvalid?: number;

  @ApiPropertyOptional({ example: false, description: 'Flag if evidence was insufficient' })
  @IsBoolean()
  @IsOptional()
  insufficientEvidence?: boolean;

  @ApiPropertyOptional({ example: 'success', description: 'Status' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: null, description: 'Error code if failed' })
  @IsString()
  @IsOptional()
  errorCode?: string;
}
