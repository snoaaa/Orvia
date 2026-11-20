import { ApiProperty } from '@nestjs/swagger';
import { ConversationEntity } from './conversation.entity.js';

export class PaginatedConversationsEntity {
  @ApiProperty({ type: [ConversationEntity], description: 'Conversations on the current page' })
  data: ConversationEntity[];

  @ApiProperty({ example: 12, description: 'Total number of conversations matching the criteria' })
  total: number;

  @ApiProperty({ example: 1, description: 'Current page number' })
  page: number;

  @ApiProperty({ example: 10, description: 'Items per page' })
  limit: number;

  @ApiProperty({ example: 2, description: 'Total number of pages' })
  totalPages: number;

  constructor(partial: Partial<PaginatedConversationsEntity>) {
    this.data = partial.data ?? [];
    this.total = partial.total ?? 0;
    this.page = partial.page ?? 1;
    this.limit = partial.limit ?? 10;
    this.totalPages = partial.totalPages ?? 1;
  }
}
