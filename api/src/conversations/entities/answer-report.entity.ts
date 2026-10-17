import { ApiProperty } from '@nestjs/swagger';

export class AnswerReportEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174025', description: 'Report UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174021', description: 'Message UUID' })
  messageId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'User UUID' })
  userId: string;

  @ApiProperty({ example: 'hallucination', description: 'Reason for report (hallucination, toxic, irrelevant, incorrect_citation)' })
  reason: string;

  @ApiProperty({ example: 'The cited formula has incorrect indices on page 14.', required: false, description: 'User feedback text' })
  feedback?: string | null;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<AnswerReportEntity>) {
    Object.assign(this, partial);
  }
}
