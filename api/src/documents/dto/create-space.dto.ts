import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Main language of the documents of a space. */
export const SPACE_LANGUAGES = ['en', 'fr'] as const;
export type SpaceLanguage = (typeof SPACE_LANGUAGES)[number];
export const DEFAULT_SPACE_LANGUAGE: SpaceLanguage = 'en';

/**
 * Who a space is meant for. Stored and validated here; the read rules that use it
 * come with the access-rule issues.
 */
export const SPACE_PRIVACY_LEVELS = ['public', 'restricted', 'private'] as const;
export type SpacePrivacy = (typeof SPACE_PRIVACY_LEVELS)[number];
export const DEFAULT_SPACE_PRIVACY: SpacePrivacy = 'public';

export const SPACE_NAME_MAX_LENGTH = 100;
export const SPACE_DESCRIPTION_MAX_LENGTH = 2000;

export const normalizedLanguage = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
export const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Body of POST /documents/spaces (#97). */
export class CreateSpaceDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001', description: 'School of the space (UUID)' })
  @IsUUID()
  schoolId: string;

  @ApiProperty({
    example: 'Operating Systems & Architecture',
    description: 'Space name, unique within the school',
    maxLength: SPACE_NAME_MAX_LENGTH,
  })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(SPACE_NAME_MAX_LENGTH)
  name: string;

  @ApiPropertyOptional({
    example: 'Course materials, slide decks, and exam prep',
    description: 'Space description',
    maxLength: SPACE_DESCRIPTION_MAX_LENGTH,
  })
  @Transform(trimmed)
  @IsString()
  @MaxLength(SPACE_DESCRIPTION_MAX_LENGTH)
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: SPACE_LANGUAGES, default: DEFAULT_SPACE_LANGUAGE, description: 'Main language' })
  @Transform(normalizedLanguage)
  @IsIn(SPACE_LANGUAGES)
  @IsOptional()
  language?: SpaceLanguage;

  @ApiPropertyOptional({ enum: SPACE_PRIVACY_LEVELS, default: DEFAULT_SPACE_PRIVACY, description: 'Privacy level' })
  @IsIn(SPACE_PRIVACY_LEVELS)
  @IsOptional()
  privacy?: SpacePrivacy;
}
