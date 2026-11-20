import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { REPORT_REASONS, type ReportReason } from './report-answer.dto.js';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Query parameters for admin report monitoring (#125). */
export class ListReportsQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, description: 'Page number (minimum 1)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ example: 10, default: 10, description: 'Items per page (1-100)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174001', description: 'Filter by school UUID (platform admin or own school)' })
  @IsUUID('all')
  @IsOptional()
  schoolId?: string;

  @ApiPropertyOptional({ enum: REPORT_REASONS, description: 'Filter by report reason' })
  @Transform(trimmed)
  @IsIn(REPORT_REASONS)
  @IsOptional()
  reason?: ReportReason;
}
