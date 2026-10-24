import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
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

  @ApiPropertyOptional({ example: 50, default: 50, description: 'Max events returned, newest first' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  limit?: number;
}
