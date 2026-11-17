import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import {
  SPACE_DESCRIPTION_MAX_LENGTH,
  SPACE_LANGUAGES,
  SPACE_NAME_MAX_LENGTH,
  SPACE_PRIVACY_LEVELS,
  type SpaceLanguage,
  type SpacePrivacy,
  trimmed,
} from './create-space.dto.js';

/** A field left out is not changed; `null` is only accepted where it means "clear" (description). */
const provided = (_: object, value: unknown) => value !== undefined;

/**
 * Body of PATCH /documents/spaces/:id (#97). At least one field is required.
 * The school of a space cannot change, so `schoolId` is not accepted (400 as an unknown field).
 */
export class UpdateSpaceDto {
  @ApiPropertyOptional({
    example: 'Operating Systems & Architecture',
    description: 'Space name, unique within the school',
    maxLength: SPACE_NAME_MAX_LENGTH,
  })
  @Transform(trimmed)
  @ValidateIf(provided)
  @IsString()
  @IsNotEmpty()
  @MaxLength(SPACE_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    example: 'Course materials, slide decks, and exam prep',
    description: 'Space description; null or an empty string clears it',
    maxLength: SPACE_DESCRIPTION_MAX_LENGTH,
    nullable: true,
    type: String,
  })
  @Transform(trimmed)
  @IsString()
  @MaxLength(SPACE_DESCRIPTION_MAX_LENGTH)
  @IsOptional()
  description?: string | null;

  @ApiPropertyOptional({ enum: SPACE_LANGUAGES, description: 'Main language' })
  @ValidateIf(provided)
  @IsIn(SPACE_LANGUAGES)
  language?: SpaceLanguage;

  @ApiPropertyOptional({ enum: SPACE_PRIVACY_LEVELS, description: 'Privacy level' })
  @ValidateIf(provided)
  @IsIn(SPACE_PRIVACY_LEVELS)
  privacy?: SpacePrivacy;
}
