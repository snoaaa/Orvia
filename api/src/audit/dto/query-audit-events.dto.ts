import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { AuditAction, AuditCategory } from '../constants/audit-events.constants.js';

export class QueryAuditEventsDto {
  @ApiPropertyOptional({ enum: Object.values(AuditCategory), description: 'Filter by event category' })
  @IsIn(Object.values(AuditCategory))
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ enum: Object.values(AuditAction), description: 'Filter by action' })
  @IsIn(Object.values(AuditAction))
  @IsOptional()
  action?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'Filter by actor UUID' })
  @IsString()
  @IsOptional()
  actorId?: string;

  @ApiPropertyOptional({ example: 'user', description: 'Filter by entity type' })
  @IsString()
  @IsOptional()
  entityType?: string;

  @ApiPropertyOptional({
    example: '2026-11-01T00:00:00.000Z',
    description: 'Only events created at or after this instant (ISO 8601)',
  })
  @IsISO8601()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30T23:59:59.999Z',
    description: 'Only events created at or before this instant (ISO 8601)',
  })
  @IsISO8601()
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({
    example: '123e4567-e89b-12d3-a456-426614174001',
    description: 'Filter by school UUID. A school administrator may only pass one of their own schools (else 403).',
  })
  @IsUUID()
  @IsOptional()
  schoolId?: string;

  @ApiPropertyOptional({ example: 1, default: 1, description: 'Page number (1-based)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ example: 10, default: 10, description: 'Events per page (max 100), newest first' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}
