import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Request body for the POST /users/invite endpoint (Issue #9).
 * Admins invite users by email; platform admins may omit schoolId,
 * school admins must provide a schoolId from their own schools.
 */
export class InviteUserDto {
  @ApiProperty({
    example: 'jane.doe@school.edu',
    description: 'Email of the user to invite. Must not already exist in the system.',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: 'Jane Doe',
    description: 'Full name of the invited user',
  })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiPropertyOptional({
    example: '123e4567-e89b-12d3-a456-426614174001',
    description:
      'School to assign the invited user to. Required for school-scoped admins. ' +
      'If provided, the email domain is validated against the school\'s allowed domains ' +
      '(school_domains table). Schools without any configured domains skip domain validation.',
  })
  @IsUUID()
  @IsOptional()
  schoolId?: string;

  @ApiPropertyOptional({
    example: 'STUDENT',
    default: 'STUDENT',
    description:
      'Role for the invited user in that school (requires schoolId). ' +
      'Platform-scoped roles (e.g. PLATFORM_ADMIN) can only be assigned by a platform admin.',
  })
  @IsString()
  @IsOptional()
  role?: string;
}
