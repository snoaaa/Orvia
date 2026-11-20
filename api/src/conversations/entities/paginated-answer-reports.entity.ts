import { ApiProperty } from '@nestjs/swagger';
import { AnswerReportEntity } from './answer-report.entity.js';

export class PaginatedAnswerReportsEntity {
  @ApiProperty({ type: [AnswerReportEntity], description: 'Reports on the current page' })
  data: AnswerReportEntity[];

  @ApiProperty({ example: 3, description: 'Total number of reports matching the criteria' })
  total: number;

  @ApiProperty({ example: 1, description: 'Current page number' })
  page: number;

  @ApiProperty({ example: 10, description: 'Items per page' })
  limit: number;

  @ApiProperty({ example: 1, description: 'Total number of pages' })
  totalPages: number;

  constructor(partial: Partial<PaginatedAnswerReportsEntity>) {
    this.data = partial.data ?? [];
    this.total = partial.total ?? 0;
    this.page = partial.page ?? 1;
    this.limit = partial.limit ?? 10;
    this.totalPages = partial.totalPages ?? 1;
  }
}
