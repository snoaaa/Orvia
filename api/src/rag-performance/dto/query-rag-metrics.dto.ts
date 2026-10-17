import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class QueryRagMetricsDto {
  @ApiPropertyOptional({ example: 'gpt-4o-mini', description: 'Filter by model' })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiPropertyOptional({ example: 'success', description: 'Filter by status' })
  @IsString()
  @IsOptional()
  status?: string;
}
