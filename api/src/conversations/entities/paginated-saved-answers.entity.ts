import { ApiProperty } from '@nestjs/swagger';
import { SavedAnswerEntity } from './saved-answer.entity.js';

export class PaginatedSavedAnswersEntity {
  @ApiProperty({ type: [SavedAnswerEntity], description: 'Saved answers on the current page' })
  data: SavedAnswerEntity[];

  @ApiProperty({ example: 5, description: 'Total number of saved answers' })
  total: number;

  @ApiProperty({ example: 1, description: 'Current page number' })
  page: number;

  @ApiProperty({ example: 10, description: 'Items per page' })
  limit: number;

  @ApiProperty({ example: 1, description: 'Total number of pages' })
  totalPages: number;

  constructor(partial: Partial<PaginatedSavedAnswersEntity>) {
    this.data = partial.data ?? [];
    this.total = partial.total ?? 0;
    this.page = partial.page ?? 1;
    this.limit = partial.limit ?? 10;
    this.totalPages = partial.totalPages ?? 1;
  }
}
