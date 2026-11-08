import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const GROUP_TYPES = ['class', 'department', 'team'] as const;

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Body of POST /groups (#33). */
export class CreateGroupDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001', description: 'School of the group (UUID)' })
  @IsUUID()
  schoolId: string;

  @ApiProperty({ example: 'Class 4-ISI-A', description: 'Group name, unique within the school', maxLength: 191 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name: string;

  @ApiPropertyOptional({ enum: GROUP_TYPES, default: 'class', description: 'Group type' })
  @IsIn(GROUP_TYPES)
  @IsOptional()
  type?: (typeof GROUP_TYPES)[number];
}
