import { ApiProperty } from '@nestjs/swagger';

export class MessageEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174021', description: 'Message UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174020', description: 'Conversation UUID' })
  conversationId: string;

  @ApiProperty({ example: 'assistant', description: 'Sender role (user, assistant, system)' })
  role: string;

  @ApiProperty({ example: 'Backpropagation computes the gradient of the loss function with respect to weights...', description: 'Message content' })
  content: string;

  @ApiProperty({ example: 'gpt-4o-mini', description: 'Model used to generate message' })
  modelUsed: string;

  @ApiProperty({ example: { temperature: 0.2, max_tokens: 500 }, description: 'Generation parameters' })
  parameters: Record<string, unknown> | null;

  @ApiProperty({ example: 'completed', description: 'Message status (streaming, completed, failed)' })
  status: string;

  @ApiProperty({ example: { userId: '123e4567-e89b-12d3-a456-426614174000', role: 'STUDENT' }, description: 'Auth snapshot at time of prompt' })
  authSnapshot: Record<string, unknown> | null;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  @ApiProperty({ example: null, required: false, description: 'Soft deletion timestamp' })
  deletedAt?: Date | null;

  constructor(partial: Partial<MessageEntity>) {
    Object.assign(this, partial);
  }
}
