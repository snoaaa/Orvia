import { ApiProperty } from '@nestjs/swagger';
import { ProcessingJobEntity } from './processing-job.entity.js';

/** Status of the current version of a document (#112). */
export class CurrentVersionStatusEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174012', description: 'Version UUID' })
  id: string;

  @ApiProperty({ example: 2, description: 'Version number' })
  versionNo: number;

  @ApiProperty({
    enum: ['pending', 'ocr', 'segmentation', 'indexing', 'available', 'error'],
    example: 'segmentation',
    description: 'Processing status (spec §3.1)',
  })
  status: string;

  @ApiProperty({ example: null, nullable: true, type: String, description: 'Why processing failed (status error)' })
  statusError: string | null;

  @ApiProperty({ example: '2026-11-19T12:05:00.000Z', description: 'When the status last changed' })
  statusChangedAt: Date;
}

/** Answer of GET /documents/:id/status (#112). */
export class DocumentProcessingStatusEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174010', description: 'Document UUID' })
  documentId: string;

  @ApiProperty({
    type: CurrentVersionStatusEntity,
    nullable: true,
    description: 'The current (latest) version; null for a document registered without a file',
  })
  currentVersion: CurrentVersionStatusEntity | null;

  @ApiProperty({ type: [ProcessingJobEntity], description: 'Processing jobs of the current version, oldest first' })
  steps: ProcessingJobEntity[];

  constructor(partial: Partial<DocumentProcessingStatusEntity>) {
    Object.assign(this, partial);
  }
}
