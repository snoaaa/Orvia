import { ApiProperty } from '@nestjs/swagger';

export class ConversationEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174020', description: 'Conversation UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'User UUID' })
  userId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174011', description: 'Space UUID' })
  spaceId: string;

  @ApiProperty({ example: 'Discussion on Backpropagation algorithm', description: 'Conversation title' })
  title: string;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  @ApiProperty({ example: null, required: false, description: 'Soft deletion timestamp' })
  deletedAt?: Date | null;

  constructor(partial: Partial<ConversationEntity>) {
    Object.assign(this, partial);
  }
}
