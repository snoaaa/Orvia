import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DOCUMENT_STATUSES, type DocumentStatus } from '../utils/document-filters.util.js';

/** Body of the dev-only POST /documents/dev/versions/:versionId/status (#112). */
export class SetVersionStatusDto {
  @ApiProperty({ enum: DOCUMENT_STATUSES, example: 'segmentation', description: 'New processing status' })
  @IsIn(DOCUMENT_STATUSES)
  status: DocumentStatus;

  @ApiPropertyOptional({ example: 'OCR failed: page 3 is unreadable', description: "Why it failed; required for 'error'" })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  reason?: string;
}
