import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Request payload for inviting a new user (Issue #9).
 * The user is registered with status INVITED and no password.
 * Authentication will be performed via institutional Google OAuth / OpenID Connect.
 */
export class InviteUserDto {
  @ApiProperty({
    example: 'jane.doe@school.edu',
    description: 'Email address of the user to invite. Must be unique across the platform.',
    maxLength: 254,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(254)
  email: string;

  @ApiProperty({
    example: 'Jane Doe',
    description: 'Full name of the invited user',
    maxLength: 100,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName: string;

  @ApiPropertyOptional({
    example: '123e4567-e89b-12d3-a456-426614174001',
    description:
      'Target educational institution (school). Required for school administrators. ' +
      'If provided, the email domain is validated against the school\'s allowed domains in school_domains. ' +
      'Schools with no configured domains permit any domain.',
  })
  @IsUUID()
  @IsOptional()
  schoolId?: string;

  @ApiPropertyOptional({
    example: 'STUDENT',
    default: 'STUDENT',
    description:
      'Role assigned to the invited user within the school (requires schoolId). ' +
      'Platform-scoped roles (e.g. PLATFORM_ADMIN) require platform administrator privileges.',
  })
  @IsString()
  @IsOptional()
  role?: string;
}
