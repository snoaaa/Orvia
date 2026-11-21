import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MESSAGE_GENERATION_STATUSES, type MessageGenerationStatus } from '../utils/generation-status.util.js';
import { MessageEntity } from './message.entity.js';

// Moved to utils (the message entity needs them too); exported here for existing imports.
export { MESSAGE_GENERATION_STATUSES, normalizeGenerationStatus } from '../utils/generation-status.util.js';
export type { MessageGenerationStatus } from '../utils/generation-status.util.js';

/** Polling response for GET /conversations/:id/messages/:messageId/status (#122). */
export class MessageGenerationStatusEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174021', description: 'Message UUID' })
  messageId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174020', description: 'Conversation UUID' })
  conversationId: string;

  @ApiProperty({
    enum: MESSAGE_GENERATION_STATUSES,
    example: 'done',
    description: 'Current generation state of the answer (pending, generating, done, failed)',
  })
  status: MessageGenerationStatus;

  @ApiProperty({ example: true, description: 'True once the answer is ready (status === "done")' })
  ready: boolean;

  @ApiProperty({ example: 'mock-rag-v1', description: 'Model identifier assigned to this message' })
  modelUsed: string;

  @ApiPropertyOptional({ example: null, nullable: true, type: String, description: 'Failure code when status is failed' })
  errorCode: string | null;

  @ApiProperty({ example: '2026-11-21T00:20:00.000Z', description: 'Timestamp of the last status update' })
  updatedAt: Date;

  @ApiPropertyOptional({
    type: MessageEntity,
    nullable: true,
    description: 'Completed message with citations when status is done; null otherwise',
  })
  answer: MessageEntity | null;

  constructor(partial: Partial<MessageGenerationStatusEntity>) {
    Object.assign(this, partial);
  }
}
