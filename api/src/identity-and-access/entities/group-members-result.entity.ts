import { ApiProperty } from '@nestjs/swagger';

/** Answer of POST /groups/:id/members (#36). */
export class AddGroupMembersResultEntity {
  @ApiProperty({ type: [String], description: 'Users added by this request' })
  added: string[];

  @ApiProperty({ type: [String], description: 'Users that were already members (left unchanged)' })
  alreadyMembers: string[];

  @ApiProperty({ example: 12, description: 'Number of members after the request' })
  memberCount: number;

  constructor(partial: AddGroupMembersResultEntity) {
    Object.assign(this, partial);
  }
}
