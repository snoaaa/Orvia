import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageEntity } from './message.entity.js';

export const MESSAGE_GENERATION_STATUSES = ['pending', 'generating', 'done', 'failed'] as const;
export type MessageGenerationStatus = (typeof MESSAGE_GENERATION_STATUSES)[number];

/** Normalizes stored message status values (including legacy 'completed'/'streaming') into §4.2 states. */
export function normalizeGenerationStatus(raw?: string | null): MessageGenerationStatus {
  switch (raw) {
    case 'pending':
      return 'pending';
    case 'generating':
    case 'streaming':
      return 'generating';
    case 'done':
    case 'completed':
      return 'done';
    case 'failed':
    case 'error':
      return 'failed';
    default:
      return 'pending';
  }
}

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
