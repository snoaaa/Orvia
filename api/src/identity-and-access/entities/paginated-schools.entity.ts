import { ApiProperty } from '@nestjs/swagger';
import { SchoolEntity } from './school.entity.js';

export class PaginatedSchoolsEntity {
  @ApiProperty({ type: [SchoolEntity], description: 'List of schools for the current page' })
  data: SchoolEntity[];

  @ApiProperty({ example: 42, description: 'Total number of schools matching the criteria' })
  total: number;

  @ApiProperty({ example: 1, description: 'Current page number' })
  page: number;

  @ApiProperty({ example: 10, description: 'Items per page' })
  limit: number;

  @ApiProperty({ example: 5, description: 'Total number of pages' })
  totalPages: number;

  constructor(partial: Partial<PaginatedSchoolsEntity>) {
    this.data = partial.data ?? [];
    this.total = partial.total ?? 0;
    this.page = partial.page ?? 1;
    this.limit = partial.limit ?? 10;
    this.totalPages = partial.totalPages ?? 1;
  }
}
