import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Body of POST /assignments (#47): gives a user a role in a school, optionally in one of its groups. */
export class CreateAssignmentDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'User to assign (UUID)' })
  @IsUUID()
  userId: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174001',
    description:
      'School the assignment applies to. Validated as a non-empty string rather than a UUID because the seeded ' +
      'system school id is not RFC-valid; an unknown id answers 404.',
  })
  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @ApiPropertyOptional({
    example: '123e4567-e89b-12d3-a456-426614174003',
    description: 'Optional group of that school (UUID). The user is also added to the group members.',
  })
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiProperty({
    example: 'STAFF',
    description: 'Role name to grant (case-insensitive), at or below your own level',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  role: string;
}
