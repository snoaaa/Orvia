import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  DOCUMENT_FIELD_MAX_LENGTH,
  DOCUMENT_MAX_TAGS,
  MaxTags,
  normalizeTagsTransform,
  trimString,
} from './document-metadata.validators.js';

export class UploadDocumentDto {
  @ApiPropertyOptional({
    example: 'Machine Learning Lecture Notes',
    description: 'Document title (defaults to filename without extension if omitted)',
    maxLength: DOCUMENT_FIELD_MAX_LENGTH,
  })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(DOCUMENT_FIELD_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({
    example: 'Prof. Turing',
    description: 'Author or lecturer name (defaults to caller full name)',
    maxLength: DOCUMENT_FIELD_MAX_LENGTH,
  })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(DOCUMENT_FIELD_MAX_LENGTH)
  author?: string;

  @ApiPropertyOptional({
    example: 'ml,neural-networks,ai',
    description: `Comma-separated tags for search and categorization (up to ${DOCUMENT_MAX_TAGS} tags, ${DOCUMENT_FIELD_MAX_LENGTH} chars normalized)`,
    maxLength: DOCUMENT_FIELD_MAX_LENGTH,
  })
  @Transform(normalizeTagsTransform)
  @IsOptional()
  @IsString()
  @MaxTags(DOCUMENT_MAX_TAGS)
  @MaxLength(DOCUMENT_FIELD_MAX_LENGTH)
  tags?: string;
}

