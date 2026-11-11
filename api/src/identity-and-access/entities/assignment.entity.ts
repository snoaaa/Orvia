import { ApiProperty } from '@nestjs/swagger';

/** A user's role in a school, optionally in one of its groups (POST /assignments, #47). */
export class AssignmentEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174005' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  userId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001' })
  schoolId: string;

  @ApiProperty({ example: 'Saint Jean Ingénieur' })
  schoolName: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174003', type: String, nullable: true })
  groupId: string | null;

  @ApiProperty({ example: 'ISI 4', type: String, nullable: true })
  groupName: string | null;

  @ApiProperty({ example: 'STAFF', description: 'Role name' })
  role: string;

  @ApiProperty({ example: 'school', description: 'Role scope (platform, school, group)' })
  roleScope: string;

  @ApiProperty({ example: '2026-11-09T12:00:00.000Z' })
  createdAt: Date;

  constructor(partial: Partial<AssignmentEntity>) {
    Object.assign(this, partial);
  }
}

/** A role the current admin may assign (GET /assignments/assignable-roles, #47). */
export class AssignableRoleEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174002' })
  id: string;

  @ApiProperty({ example: 'STAFF' })
  name: string;

  @ApiProperty({ example: 'school', description: 'Role scope (platform, school, group)' })
  scope: string;

  @ApiProperty({ example: 2, description: 'Level derived from the scope: platform 3, school 2, group 1, other 0' })
  level: number;

  constructor(partial: Partial<AssignableRoleEntity>) {
    Object.assign(this, partial);
  }
}
