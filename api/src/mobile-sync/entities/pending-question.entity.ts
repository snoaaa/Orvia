import { ApiProperty } from '@nestjs/swagger';

export class PendingQuestionEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174042', description: 'Question UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174040', description: 'Originating device UUID' })
  deviceId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174020', description: 'Target conversation UUID' })
  conversationId: string;

  @ApiProperty({ example: 'What is the role of eigenvalues in PCA?', description: 'Queued offline question text' })
  content: string;

  @ApiProperty({ example: 'pending', description: 'Sync status (pending, processing, resolved, failed)' })
  status: string;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<PendingQuestionEntity>) {
    Object.assign(this, partial);
  }
}
