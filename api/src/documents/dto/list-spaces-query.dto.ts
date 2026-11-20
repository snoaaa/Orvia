import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

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

  @ApiPropertyOptional({ description: 'Only the spaces whose name contains this text (case-insensitive, max 100)' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    description:
      'Only the spaces of this school. Meant for platform admins; for anyone else it can only narrow the ' +
      'spaces they already see (a school outside their scope gives an empty list).',
  })
  @IsUUID()
  @IsOptional()
  schoolId?: string;
}
