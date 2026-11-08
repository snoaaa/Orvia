import { ApiProperty } from '@nestjs/swagger';
import { SpaceEntity } from './space.entity.js';

export class PaginatedSpacesEntity {
  @ApiProperty({ type: [SpaceEntity], description: 'List of spaces for the current page' })
  data: SpaceEntity[];

  @ApiProperty({ example: 12, description: 'Total number of spaces matching the criteria' })
  total: number;

  @ApiProperty({ example: 1, description: 'Current page number' })
  page: number;

  @ApiProperty({ example: 10, description: 'Items per page' })
  limit: number;

  @ApiProperty({ example: 2, description: 'Total number of pages' })
  totalPages: number;

  constructor(partial: Partial<PaginatedSpacesEntity>) {
    this.data = partial.data ?? [];
    this.total = partial.total ?? 0;
    this.page = partial.page ?? 1;
    this.limit = partial.limit ?? 10;
    this.totalPages = partial.totalPages ?? 1;
  }
}
