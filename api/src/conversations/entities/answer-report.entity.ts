import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AnswerReportEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174025', description: 'Report UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174021', description: 'Message UUID' })
  messageId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'Reporter user UUID' })
  userId: string;

  @ApiProperty({ example: 'hallucination', description: 'Reason for report' })
  reason: string;

  @ApiPropertyOptional({ example: 'The cited formula has incorrect indices on page 14.', nullable: true, description: 'User feedback text' })
  feedback?: string | null;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174020', description: 'Conversation UUID' })
  conversationId?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174001', description: 'School UUID of the conversation space' })
  schoolId?: string;

  @ApiPropertyOptional({ example: 'Backpropagation computes the gradient...', description: 'Reported answer content' })
  messageContent?: string;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<AnswerReportEntity>) {
    Object.assign(this, partial);
  }
}
