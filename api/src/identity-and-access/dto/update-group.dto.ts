import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { GROUP_TYPES } from './create-group.dto.js';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Body of PATCH /groups/:id (#34). At least one field is required; the school cannot change. */
export class UpdateGroupDto {
  @ApiPropertyOptional({ example: 'Class 4-ISI-B', description: 'New name, unique within the school', maxLength: 191 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ enum: GROUP_TYPES, description: 'New type' })
  @IsIn(GROUP_TYPES)
  @IsOptional()
  type?: (typeof GROUP_TYPES)[number];
}
