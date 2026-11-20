import { ApiProperty } from '@nestjs/swagger';
import { MessageCitationEntity } from './message-citation.entity.js';

/** Result of POST /conversations/:id/messages/:messageId/share (#125). */
export class ShareAnswerResultEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174021', description: 'Shared message UUID' })
  messageId: string;

  @ApiProperty({ example: 'eyJ0eXAiOi...', description: 'Signed share token for the link' })
  shareToken: string;

  @ApiProperty({ example: '/conversations/shared/eyJ0eXAiOi...', description: 'Relative API path to resolve the shared answer' })
  sharePath: string;

  @ApiProperty({
    example: 'Backpropagation computes the gradient...\n\nLink: /conversations/shared/eyJ0eXAiOi...',
    description: 'Ready-to-share plain text summary',
  })
  shareText: string;

  @ApiProperty({ example: '2026-11-28T00:25:00.000Z', description: 'Expiration timestamp of the share link' })
  expiresAt: Date;

  constructor(partial: Partial<ShareAnswerResultEntity>) {
    Object.assign(this, partial);
  }
}

/**
 * Receiver view of GET /conversations/shared/:token (#125).
 * Only citations pointing to documents visible to the signed-in receiver are included;
 * unauthorized citations are stripped and counted in `redactedCitationsCount`.
 */
export class SharedAnswerViewEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174021', description: 'Message UUID' })
  messageId: string;

  @ApiProperty({ example: 'Backpropagation computes the gradient...', description: 'Answer text' })
  content: string;

  @ApiProperty({ example: 'mock-rag-v1', description: 'Model used to generate the answer' })
  modelUsed: string;

  @ApiProperty({ type: [MessageCitationEntity], description: 'Citations for documents the receiver is permitted to see' })
  citations: MessageCitationEntity[];

  @ApiProperty({ example: 1, description: 'Number of citations hidden because the receiver lacks access to their source documents' })
  redactedCitationsCount: number;

  @ApiProperty({ example: '2026-11-21T00:00:00.000Z', description: 'When the answer was generated' })
  createdAt: Date;

  constructor(partial: Partial<SharedAnswerViewEntity>) {
    this.citations = partial.citations ?? [];
    this.redactedCitationsCount = partial.redactedCitationsCount ?? 0;
    Object.assign(this, partial);
  }
}
