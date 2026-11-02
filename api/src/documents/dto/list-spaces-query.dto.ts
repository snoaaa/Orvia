import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Query for the paginated space list. Same `page`/`limit` contract as the other lists. */
export class ListSpacesQueryDto {
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
}
