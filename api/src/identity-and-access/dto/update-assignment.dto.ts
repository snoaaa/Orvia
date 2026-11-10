import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Body of PATCH /assignments/:id (#48): changes the role and/or the group of an assignment.
 * The school is not editable (no `schoolId` field, so sending one is 400).
 */
export class UpdateAssignmentDto {
  @ApiPropertyOptional({
    example: 'STAFF',
    description: 'New role name (case-insensitive), at or below your own level. Left out: the role is kept.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  role?: string;

  @ApiPropertyOptional({
    example: '123e4567-e89b-12d3-a456-426614174003',
    type: String,
    nullable: true,
    description:
      'New group of the same school (UUID): the user leaves the old group members and joins the new one. ' +
      '`null` removes the group (and the old membership). Left out: the group is kept.',
  })
  @IsOptional()
  @IsUUID()
  groupId?: string | null;
}
