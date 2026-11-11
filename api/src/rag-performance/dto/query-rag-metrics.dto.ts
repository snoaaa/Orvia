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

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174001', description: 'Filter by school' })
  @IsString()
  @IsOptional()
  schoolId?: string;
}
