import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Query for the permission overview.
 *
 * Without `code` the endpoint returns every permission with its roles and a holder **count**.
 * With `code` it also returns the holders for that single permission, grouped per user and school,
 * capped by `limit` — which keeps the response bounded whatever the size of the platform.
 */
export class QueryPermissionOverviewDto {
  @ApiPropertyOptional({
    example: 'users:invite',
    description: 'Drill into one permission: adds its holders list',
    maxLength: 100,
  })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({
    example: 50,
    default: 50,
    description: 'Maximum holders returned when `code` is given (1-200)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit?: number;
}
