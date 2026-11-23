import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MESSAGE_GENERATION_STATUSES, type MessageGenerationStatus } from '../utils/generation-status.util.js';
import { MessageCitationEntity } from './message-citation.entity.js';

/**
 * A message of a conversation: the user's question or the assistant's answer (#119, spec §4.2, §4.3).
 *
 * In an assistant answer, `content` refers to its sources with markers such as `[1]` and `[2]`; each marker
 * is the `marker` of one entry of `citations`. When the documents do not contain the answer,
 * `notEnoughEvidence` is true, `citations` is empty and `content` says so instead of inventing an answer.
 */
export class MessageEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174021', description: 'Message UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174020', description: 'Conversation UUID' })
  conversationId: string;

  @ApiProperty({ enum: ['user', 'assistant', 'system'], example: 'assistant', description: 'Who wrote the message' })
  role: string;

  @ApiProperty({
    example:
      'Backpropagation applies the chain rule layer by layer [1], starting from the gradient of the loss [2].',
    description: 'Question, or answer text with citation markers `[n]` (empty while the answer is generated)',
  })
  content: string;

  @ApiProperty({ example: 'gpt-4o-mini', description: 'Model that generated the answer (`default` for questions)' })
  modelUsed: string;

  @ApiProperty({ example: { temperature: 0.2, max_tokens: 500 }, nullable: true, description: 'Generation parameters' })
  parameters: Record<string, unknown> | null;

  @ApiProperty({
    enum: MESSAGE_GENERATION_STATUSES,
    example: 'done',
    description:
      'Generation state: `pending` (queued), `generating`, `done` (content and citations final) or `failed`. ' +
      'Questions are always `done`.',
  })
  status: MessageGenerationStatus;

  @ApiProperty({
    example: false,
    description: 'True when the documents do not contain enough evidence to answer: no citations, no invented answer',
  })
  notEnoughEvidence: boolean;

  @ApiProperty({
    type: [MessageCitationEntity],
    description: 'Sources of the answer, ordered by marker; empty for questions and "not enough evidence" answers',
  })
  citations: MessageCitationEntity[];

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
