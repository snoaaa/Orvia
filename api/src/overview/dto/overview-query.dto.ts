import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const OVERVIEW_RANGES = ['7d', '30d', '12m'] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

/** Query for the dashboard overview. `7d`/`30d` bucket by day, `12m` by month. */
export class OverviewQueryDto {
  @ApiPropertyOptional({
    enum: OVERVIEW_RANGES,
    default: '7d',
    description: 'Time window and bucket size of the series: 7 or 30 daily points, or 12 monthly points',
  })
  @IsIn(OVERVIEW_RANGES)
  @IsOptional()
  range?: OverviewRange;
}
