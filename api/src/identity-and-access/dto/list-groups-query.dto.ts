import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { GROUP_TYPES } from './create-group.dto.js';

export const GROUP_SORT_FIELDS = ['createdAt', 'name', 'type'] as const;
export type GroupSortField = (typeof GROUP_SORT_FIELDS)[number];

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** Query of GET /groups (#34). Every filter is optional and they can be combined. */
export class ListGroupsQueryDto {
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

  @ApiPropertyOptional({ example: 'isi', description: 'Part of the group name (case-insensitive)' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174001', description: 'Only groups of this school' })
  @IsUUID()
  @IsOptional()
  schoolId?: string;

  @ApiPropertyOptional({ enum: GROUP_TYPES, description: 'Only groups of this type' })
  @Transform(lower)
  @IsIn(GROUP_TYPES)
  @IsOptional()
  type?: (typeof GROUP_TYPES)[number];

  @ApiPropertyOptional({ enum: GROUP_SORT_FIELDS, default: 'createdAt', description: 'Sort field' })
  @IsIn(GROUP_SORT_FIELDS)
  @IsOptional()
  sortBy?: GroupSortField;

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    description: 'Sort direction; defaults to desc for createdAt and asc for the others',
  })
  @Transform(lower)
  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc';
}
