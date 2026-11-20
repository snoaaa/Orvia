import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageCitationEntity } from './message-citation.entity.js';

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

  @ApiProperty({ example: { temperature: 0.2, max_tokens: 500 }, nullable: true, description: 'Generation parameters' })
  parameters: Record<string, unknown> | null;

  @ApiProperty({
    enum: ['pending', 'generating', 'done', 'failed', 'completed'],
    example: 'done',
    description: 'Message generation status (pending, generating, done, failed)',
  })
  status: string;

  @ApiPropertyOptional({ type: [MessageCitationEntity], description: 'Source citations supporting this message' })
  citations?: MessageCitationEntity[];

  @ApiPropertyOptional({ example: null, nullable: true, description: 'Auth snapshot (internal/monitoring only)' })
  authSnapshot?: Record<string, unknown> | null;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  @ApiPropertyOptional({ example: null, description: 'Soft deletion timestamp' })
  deletedAt?: Date | null;

  constructor(partial: Partial<MessageEntity>) {
    Object.assign(this, partial);
  }
}
