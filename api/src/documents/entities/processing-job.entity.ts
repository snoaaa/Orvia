import { ApiProperty } from '@nestjs/swagger';

export class ProcessingJobEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174013', description: 'Processing job UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174012', description: 'Document version UUID' })
  versionId: string;

  @ApiProperty({ example: 'chunking_and_embedding', description: 'Current processing step' })
  step: string;

  @ApiProperty({ example: 'completed', description: 'Job status (pending, in_progress, completed, failed)' })
  status: string;

  @ApiProperty({ example: null, required: false, description: 'Error message if failed' })
  error?: string | null;

  @ApiProperty({ example: 3420, description: 'Duration in milliseconds' })
  durationMs: number;

  @ApiProperty({ example: 0.98, description: 'OCR confidence score' })
  ocrConfidence: number;

  @ApiProperty({ example: 42, description: 'Page count processed' })
  pageCount: number;

  @ApiProperty({ example: 128, description: 'Number of chunks generated' })
  chunkCount: number;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<ProcessingJobEntity>) {
    Object.assign(this, partial);
  }
}
