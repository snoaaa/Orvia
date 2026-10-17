import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class QueryAuditEventsDto {
  @ApiPropertyOptional({ example: 'AUTH', description: 'Filter by event category' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'Filter by actor UUID' })
  @IsString()
  @IsOptional()
  actorId?: string;

  @ApiPropertyOptional({ example: 'user', description: 'Filter by entity type' })
  @IsString()
  @IsOptional()
  entityType?: string;
}
