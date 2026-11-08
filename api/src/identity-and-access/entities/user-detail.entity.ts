import { ApiProperty } from '@nestjs/swagger';
import { ActiveSessionEntity } from '../../auth/entities/index.js';
import { UserAssignmentSummaryEntity } from './user-list-item.entity.js';

/** A group the user is a member of. */
export class UserGroupSummaryEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174002' })
  groupId: string;

  @ApiProperty({ example: 'ISI 4' })
  groupName: string;

  @ApiProperty({ example: 'class' })
  groupType: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001' })
  schoolId: string;

  @ApiProperty({ example: 'Saint Jean Ingénieur' })
  schoolName: string;
}

/**
 * A user in GET /users/:id. Never contains the password hash, tokens or the Google id.
 * `assignments` and `groups` only list the schools the requesting admin can see.
 */
export class UserDetailEntity {
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

  @ApiProperty({ example: true, description: 'The user has set a password' })
  hasPassword: boolean;

  @ApiProperty({ example: false, description: 'A Google account is linked' })
  googleLinked: boolean;

  @ApiProperty({ type: [UserAssignmentSummaryEntity] })
  assignments: UserAssignmentSummaryEntity[];

  @ApiProperty({ type: [UserGroupSummaryEntity] })
  groups: UserGroupSummaryEntity[];

  @ApiProperty({ type: [ActiveSessionEntity], description: 'Active sessions and their devices, newest first' })
  sessions: ActiveSessionEntity[];

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z' })
  updatedAt: Date;

  constructor(partial: UserDetailEntity) {
    Object.assign(this, partial);
  }
}
