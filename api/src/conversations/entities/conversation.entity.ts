import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConversationEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174020', description: 'Conversation UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'Owner user UUID' })
  userId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174011', description: 'Space UUID' })
  spaceId: string;

  @ApiPropertyOptional({ example: 'Mathematics 101', description: 'Name of the conversation space' })
  spaceName?: string;

  @ApiProperty({ example: 'Discussion on Backpropagation algorithm', description: 'Conversation title' })
  title: string;

  @ApiPropertyOptional({ example: 4, description: 'Number of active messages in the conversation' })
  messageCount?: number;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  @ApiPropertyOptional({ example: null, description: 'Soft deletion timestamp' })
  deletedAt?: Date | null;

  constructor(partial: Partial<ConversationEntity>) {
    Object.assign(this, partial);
  }
}
