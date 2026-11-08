import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { USER_SORT_FIELDS, type UserSortField } from './list-users-query.dto.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Query of GET /users (#38). Every filter is optional and they can be combined. */
export class SearchUsersQueryDto {
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

  @ApiPropertyOptional({ example: 'jane', description: 'Part of the full name or email (case-insensitive)' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174001', description: 'Only users assigned to this school' })
  @IsUUID()
  @IsOptional()
  schoolId?: string;

  @ApiPropertyOptional({ example: 'STAFF', description: 'Only users holding this role (in the filtered school, if any)' })
  @Transform(upper)
  @IsString()
  @MaxLength(100)
  @IsOptional()
  role?: string;

  @ApiPropertyOptional({
    example: '123e4567-e89b-12d3-a456-426614174002',
    description: 'Only users in this group (assigned to it, or members of it)',
  })
  @IsUUID()
  @IsOptional()
  groupId?: string;

  @ApiPropertyOptional({ enum: ['INVITED', 'ACTIVE', 'SUSPENDED'], description: 'Account status' })
  @Transform(upper)
  @IsIn(['INVITED', 'ACTIVE', 'SUSPENDED'])
  @IsOptional()
  status?: 'INVITED' | 'ACTIVE' | 'SUSPENDED';

  @ApiPropertyOptional({ enum: USER_SORT_FIELDS, default: 'createdAt', description: 'Sort field' })
  @IsIn(USER_SORT_FIELDS)
  @IsOptional()
  sortBy?: UserSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc', description: 'Sort direction' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsIn(['asc', 'desc'])
  @IsOptional()
  order?: 'asc' | 'desc';
}
