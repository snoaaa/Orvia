import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { DOCUMENT_STATUSES, DOCUMENT_TYPES, type DocumentStatus, type DocumentType, parseTags } from '../utils/document-filters.util.js';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Query for the paginated document list (#111). Same `page`/`limit` contract as
 * `ListUsersQueryDto` / `ListSchoolsQueryDto`; every filter is optional and they combine with AND.
 */
export class ListDocumentsQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, description: 'Page number (minimum 1)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ example: 10, default: 10, description: 'Items per page (1-100)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174011', description: 'Only documents of this space' })
  @IsUUID('all')
  @IsOptional()
  spaceId?: string;

  @ApiPropertyOptional({ example: 'algebra', description: 'Search in the title (case-insensitive, 1-200 characters)' })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({
    type: String,
    example: 'math,physics',
    description: 'Comma-separated tags; a document must carry all of them as whole tags (up to 10)',
  })
  @Transform(({ value }) => (typeof value === 'string' ? parseTags(value) : value))
  @IsString({ each: true })
  @ArrayMaxSize(10)
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({
    enum: DOCUMENT_STATUSES,
    description: 'Processing status of the current version. Readers who do not manage documents only ever see available ones.',
  })
  @IsIn(DOCUMENT_STATUSES)
  @IsOptional()
  status?: DocumentStatus;

  @ApiPropertyOptional({ enum: DOCUMENT_TYPES, description: 'File type of the current version' })
  @IsIn(DOCUMENT_TYPES)
  @IsOptional()
  type?: DocumentType;
}
