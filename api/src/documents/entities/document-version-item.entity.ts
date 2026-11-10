import { ApiProperty } from '@nestjs/swagger';

export class DocumentVersionUploaderEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001', description: 'Uploader user UUID' })
  id: string;

  @ApiProperty({ example: 'Jane Doe', description: 'Uploader display name' })
  name: string;

  @ApiProperty({ example: 'jane.doe@school.org', description: 'Uploader email' })
  email: string;

  constructor(partial: Partial<DocumentVersionUploaderEntity>) {
    Object.assign(this, partial);
  }
}

export class DocumentVersionItemEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174012', description: 'Version UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174010', description: 'Document UUID' })
  documentId: string;

  @ApiProperty({ example: 2, description: 'Sequential version number' })
  versionNumber: number;

  @ApiProperty({ example: 2, description: 'Sequential version number (alias for compatibility)' })
  versionNo: number;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Version creation date' })
  date: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Version creation timestamp (alias)' })
  createdAt: Date;

  @ApiProperty({
    type: () => DocumentVersionUploaderEntity,
    nullable: true,
    description: 'User who uploaded or replaced this version, or null if unknown',
  })
  uploader: DocumentVersionUploaderEntity | null;

  @ApiProperty({ example: 1048576, description: 'File size in bytes' })
  size: number;

  @ApiProperty({ example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', description: 'SHA-256 checksum' })
  checksum: string;

  @ApiProperty({ example: 'indexed', description: 'Processing status (pending, processing, indexed, error)' })
  status: string;

  @ApiProperty({ example: 'application/pdf', description: 'MIME type' })
  mimeType: string;

  @ApiProperty({ example: 'spaces/space-1/docs/doc-1/v2.pdf', description: 'Storage key' })
  storageKey: string;

  @ApiProperty({ example: 14, description: 'Page count' })
  pageCount: number;

  @ApiProperty({ example: true, description: 'Whether this is the current active version' })
  isCurrent: boolean;

  constructor(partial: Partial<DocumentVersionItemEntity>) {
    Object.assign(this, partial);
  }
}
