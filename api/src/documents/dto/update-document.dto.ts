import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  DOCUMENT_FIELD_MAX_LENGTH,
  DOCUMENT_MAX_TAGS,
  MaxTags,
  normalizeTagsTransform,
  trimString,
} from './document-metadata.validators.js';

export class UpdateDocumentDto {
  @ApiPropertyOptional({
    example: 'Lecture Notes - Advanced Algorithms (Rev 2)',
    description: 'Updated document title',
    maxLength: DOCUMENT_FIELD_MAX_LENGTH,
  })
  @Transform(trimString)
  @IsString()
  @MaxLength(DOCUMENT_FIELD_MAX_LENGTH)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({
    example: 'Prof. Donald Knuth',
    description: 'Updated author',
    maxLength: DOCUMENT_FIELD_MAX_LENGTH,
  })
  @Transform(trimString)
  @IsString()
  @MaxLength(DOCUMENT_FIELD_MAX_LENGTH)
  @IsOptional()
  author?: string;

  @ApiPropertyOptional({ example: '2026-10-15T09:00:00.000Z', description: 'Updated document date (ISO 8601 string)' })
  @IsISO8601()
  @IsOptional()
  date?: string;

  @ApiPropertyOptional({
    example: 'algorithms,cs,graphs,sorting',
    description: `Updated tags (up to ${DOCUMENT_MAX_TAGS} tags, ${DOCUMENT_FIELD_MAX_LENGTH} chars normalized)`,
    maxLength: DOCUMENT_FIELD_MAX_LENGTH,
  })
  @Transform(normalizeTagsTransform)
  @IsString()
  @MaxTags(DOCUMENT_MAX_TAGS)
  @MaxLength(DOCUMENT_FIELD_MAX_LENGTH)
  @IsOptional()
  tags?: string;

  @ApiPropertyOptional({ example: { format: 'pdf', pages: 35 }, description: 'Updated metadata' })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
