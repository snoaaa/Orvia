import { ApiProperty } from '@nestjs/swagger';
import { UserEntity } from './user.entity.js';

export class PaginatedUsersEntity {
  @ApiProperty({ type: [UserEntity], description: 'List of users for the current page' })
  data: UserEntity[];

  @ApiProperty({ example: 42, description: 'Total number of users matching the criteria' })
  total: number;

  @ApiProperty({ example: 1, description: 'Current page number' })
  page: number;

  @ApiProperty({ example: 10, description: 'Items per page' })
  limit: number;

  @ApiProperty({ example: 5, description: 'Total number of pages' })
  totalPages: number;

  constructor(partial: Partial<PaginatedUsersEntity>) {
    this.data = partial.data ?? [];
    this.total = partial.total ?? 0;
    this.page = partial.page ?? 1;
    this.limit = partial.limit ?? 10;
    this.totalPages = partial.totalPages ?? 1;
  }
}
