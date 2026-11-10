import { ApiProperty } from '@nestjs/swagger';
import { GroupEntity } from './group.entity.js';

/** A group in GET /groups and GET /groups/:id, with its school name and roster size. */
export class GroupDetailEntity extends GroupEntity {
  @ApiProperty({ example: 'Saint Jean Ingénieur', description: 'Name of the school' })
  schoolName: string;

  @ApiProperty({ example: 32, description: 'Number of members (group_members)' })
  memberCount: number;

  constructor(partial: Partial<GroupDetailEntity>) {
    super(partial);
    // Own fields are initialised after super(), so they are assigned again here.
    Object.assign(this, partial);
  }
}

export class PaginatedGroupsEntity {
  @ApiProperty({ type: [GroupDetailEntity], description: 'Groups of the current page' })
  data: GroupDetailEntity[];

  @ApiProperty({ example: 42, description: 'Total number of groups matching the filters' })
  total: number;

  @ApiProperty({ example: 1, description: 'Current page number' })
  page: number;

  @ApiProperty({ example: 10, description: 'Items per page' })
  limit: number;

  @ApiProperty({ example: 5, description: 'Total number of pages' })
  totalPages: number;

  constructor(partial: PaginatedGroupsEntity) {
    Object.assign(this, partial);
  }
}
