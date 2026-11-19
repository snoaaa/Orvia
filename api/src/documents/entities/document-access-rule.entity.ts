import { ApiProperty } from '@nestjs/swagger';
import { DOCUMENT_ACCESS_TARGET_TYPES, type DocumentAccessTargetType } from '../utils/document-visibility.util.js';

/** One publication rule of a document (#109). */
export class DocumentAccessRuleEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174099', description: 'Rule UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174020', description: 'Document UUID' })
  documentId: string;

  @ApiProperty({ enum: DOCUMENT_ACCESS_TARGET_TYPES, example: 'class', description: 'Kind of target' })
  type: DocumentAccessTargetType;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'School, role, group or user UUID' })
  targetId: string;

  @ApiProperty({
    example: '6e A',
    nullable: true,
    type: String,
    description: 'Readable name: school, role or group name, or the full name of the user',
  })
  targetName: string | null;

  @ApiProperty({ example: '2026-11-19T12:00:00.000Z', description: 'When the document was published to this target' })
  createdAt: Date;

  constructor(partial: Partial<DocumentAccessRuleEntity>) {
    Object.assign(this, partial);
  }
}
