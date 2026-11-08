import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Columns the user list may be ordered by. */
export const USER_SORT_FIELDS = ['createdAt', 'email', 'fullName', 'status'] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

/** Account statuses, matching the Prisma `UserStatus` enum. */
export const USER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED'] as const;

/**
 * Query for the paginated user list: same `page`/`limit` contract as the other lists,
 * plus optional `status` / `search` filters and `sortBy` / `sortOrder`.
 *
 * The filters exist so the admin console can compute its "active / invited / suspended"
 * counters from `total` instead of downloading every user.
 */
export class ListUsersQueryDto {
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

  @ApiPropertyOptional({
    enum: USER_STATUSES,
    example: 'ACTIVE',
    description: 'Only users with this account status',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsIn(USER_STATUSES)
  @IsOptional()
  status?: (typeof USER_STATUSES)[number];

  @ApiPropertyOptional({
    example: 'lycee',
    description: 'Case-insensitive match on the email address or the full name',
    maxLength: 100,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    enum: USER_SORT_FIELDS,
    default: 'createdAt',
    description: 'Column to order by',
  })
  @IsIn(USER_SORT_FIELDS)
  @IsOptional()
  sortBy?: UserSortField;

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    description: 'Sort direction; defaults to desc for createdAt and asc for the others',
  })
  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc';
}
