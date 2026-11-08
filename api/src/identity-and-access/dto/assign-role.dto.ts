import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Body of `PATCH /identity/users/:id/role`: creates or replaces the user's role in one school.
 */
export class AssignRoleDto {
  @ApiProperty({
    example: 'SCHOOL_ADMIN',
    description: 'Role name to grant (case-insensitive), e.g. SCHOOL_ADMIN, CONTENT_MANAGER, STUDENT',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  role: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174001',
    description:
      'School the assignment applies to. Platform-scoped roles are anchored on the system school. ' +
      'Validated as a non-empty string rather than a UUID because the seeded system school id is not RFC-valid; ' +
      'an unknown id answers 404.',
  })
  @IsString()
  @IsNotEmpty()
  schoolId: string;
}
