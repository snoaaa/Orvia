import { ApiProperty } from '@nestjs/swagger';

export class DocumentVersionEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174012', description: 'Version UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174010', description: 'Document UUID' })
  documentId: string;

  @ApiProperty({ example: 1, description: 'Sequential version number' })
  versionNo: number;

  @ApiProperty({ example: 'documents/2026/ml-notes-v1.pdf', description: 'Storage key (S3 or local path)' })
  storageKey: string;

  @ApiProperty({ example: 'application/pdf', description: 'MIME type' })
  mimeType: string;

  @ApiProperty({ example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', description: 'SHA-256 checksum' })
  checksum: string;

  @ApiProperty({ example: 'indexed', description: 'Processing status (uploaded, processing, indexed, error)' })
  status: string;

  @ApiProperty({ example: 42, description: 'Page count' })
  pageCount: number;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<DocumentVersionEntity>) {
    Object.assign(this, partial);
  }
}
