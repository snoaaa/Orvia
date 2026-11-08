import { ApiProperty } from '@nestjs/swagger';

/** One school/role(/group) of a user, as shown in the user list. */
export class UserAssignmentSummaryEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001' })
  schoolId: string;

  @ApiProperty({ example: 'Saint Jean Ingénieur' })
  schoolName: string;

  @ApiProperty({ example: 'STAFF' })
  role: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174002', nullable: true })
  groupId: string | null;

  @ApiProperty({ example: 'ISI 4', nullable: true })
  groupName: string | null;
}

/**
 * A user in GET /users. Never contains the password hash, tokens or the Google id.
 * `assignments` only lists the schools the requesting admin can see.
 */
export class UserListItemEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: 'jane.doe@school.edu' })
  email: string;

  @ApiProperty({ example: 'Jane Doe' })
  fullName: string;

  @ApiProperty({ example: 'google', description: 'Authentication provider (local, google)' })
  authProvider: string;

  @ApiProperty({ example: 'ACTIVE', enum: ['INVITED', 'ACTIVE', 'SUSPENDED'] })
  status: string;

  @ApiProperty({ type: [UserAssignmentSummaryEntity] })
  assignments: UserAssignmentSummaryEntity[];

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z' })
  updatedAt: Date;

  constructor(partial: UserListItemEntity) {
    Object.assign(this, partial);
  }
}

export class PaginatedUserListEntity {
  @ApiProperty({ type: [UserListItemEntity], description: 'Users of the current page' })
  data: UserListItemEntity[];

  @ApiProperty({ example: 42, description: 'Total number of users matching the filters' })
  total: number;

  @ApiProperty({ example: 1, description: 'Current page number' })
  page: number;

  @ApiProperty({ example: 10, description: 'Items per page' })
  limit: number;

  @ApiProperty({ example: 5, description: 'Total number of pages' })
  totalPages: number;

  constructor(partial: PaginatedUserListEntity) {
    Object.assign(this, partial);
  }
}
