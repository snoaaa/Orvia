import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OverviewUsersEntity {
  @ApiProperty({ example: 248 }) total: number;
  @ApiProperty({ example: 186 }) active: number;
  @ApiProperty({ example: 18 }) invited: number;
  @ApiProperty({ example: 44 }) suspended: number;
  constructor(partial: OverviewUsersEntity) {
    Object.assign(this, partial);
  }
}
export class OverviewSchoolsEntity {
  @ApiProperty({ example: 12 }) total: number;
  @ApiProperty({ example: 11 }) active: number;
  @ApiProperty({ example: 1 }) deactivated: number;
  constructor(partial: OverviewSchoolsEntity) {
    Object.assign(this, partial);
  }
}
export class OverviewSessionsEntity {
  @ApiProperty({ example: 37, description: 'Sessions that are neither revoked nor expired' }) active: number;
  constructor(partial: OverviewSessionsEntity) {
    Object.assign(this, partial);
  }
}
export class OverviewDocumentsEntity {
  @ApiProperty({ example: 1842 }) total: number;
  @ApiProperty({ example: 7 }) spaces: number;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { pending: 42, completed: 1732, failed: 49 },
    description: 'Processing jobs of those documents, counted per status',
  })
  processingJobs: Record<string, number>;
  constructor(partial: OverviewDocumentsEntity) {
    Object.assign(this, partial);
  }
}
export class OverviewSeriesPointEntity {
  @ApiProperty({ example: '2026-11-02', description: 'Day (`YYYY-MM-DD`) or month (`YYYY-MM`) bucket' })
  bucket: string;

  @ApiProperty({ example: 42 }) logins: number;
  @ApiProperty({ example: 3 }) failedLogins: number;
  @ApiProperty({ example: 6, description: 'Sessions created in that bucket' }) sessionsCreated: number;
  constructor(partial: OverviewSeriesPointEntity) {
    Object.assign(this, partial);
  }
}
export class OverviewSpaceEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174011' }) id: string;
  @ApiProperty({ example: 'Mathematics' }) name: string;
  @ApiProperty({ example: 512 }) documents: number;
  constructor(partial: OverviewSpaceEntity) {
    Object.assign(this, partial);
  }
}
export class OverviewRecentEventEntity {
  @ApiProperty({ example: 214 }) seq: number;
  @ApiProperty({ example: 'authentication' }) category: string;
  @ApiProperty({ example: 'login_success' }) action: string;
  @ApiProperty({ example: 'SCHOOL_ADMIN', nullable: true }) actorRole: string | null;
  @ApiProperty({ example: 'user', nullable: true }) entityType: string | null;
  @ApiProperty({ example: null, nullable: true }) schoolId: string | null;
  @ApiProperty({ example: '2026-11-02T20:41:00.000Z' }) at: Date;
  constructor(partial: OverviewRecentEventEntity) {
    Object.assign(this, partial);
  }
}
/**
 * One payload for the whole dashboard. Each section is present only when the caller may read the
 * underlying resource, and every number is scoped to the caller's schools (platform admins see all).
 */
export class OverviewEntity {
  @ApiProperty({ example: '30d', enum: ['7d', '30d', '12m'] }) range: string;

  @ApiProperty({ example: 'platform', enum: ['platform', 'school'] })
  scope: 'platform' | 'school';

  @ApiProperty({ example: '2026-11-02T20:41:00.000Z' }) generatedAt: Date;

  @ApiPropertyOptional({ type: OverviewUsersEntity }) users?: OverviewUsersEntity;
  @ApiPropertyOptional({ type: OverviewSchoolsEntity }) schools?: OverviewSchoolsEntity;
  @ApiPropertyOptional({ type: OverviewSessionsEntity }) sessions?: OverviewSessionsEntity;
  @ApiPropertyOptional({ type: OverviewDocumentsEntity }) documents?: OverviewDocumentsEntity;
  @ApiPropertyOptional({ type: [OverviewSeriesPointEntity] }) series?: OverviewSeriesPointEntity[];
  @ApiPropertyOptional({ type: [OverviewSpaceEntity] }) spaces?: OverviewSpaceEntity[];
  @ApiPropertyOptional({ type: [OverviewRecentEventEntity] }) recent?: OverviewRecentEventEntity[];

  constructor(partial: OverviewEntity) {
    Object.assign(this, partial);
  }
}
