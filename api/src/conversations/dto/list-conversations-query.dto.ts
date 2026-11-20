import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Query parameters for listing the signed-in user's conversations (#123).
 * Follows the shared `page`/`limit` contract (`limit` capped at 100).
 */
export class ListConversationsQueryDto {
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

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174011', description: 'Filter by space UUID' })
  @IsUUID('all')
  @IsOptional()
  spaceId?: string;

  @ApiPropertyOptional({ example: 'backpropagation', description: 'Search in conversation title (case-insensitive, 1-200 characters)' })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @IsOptional()
  q?: string;
}
