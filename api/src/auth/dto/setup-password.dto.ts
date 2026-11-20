import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Request payload for setting the initial password of an invited administrator (Issue #26 / #90).
 */
export class SetupPasswordDto {
  @ApiProperty({
    example: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    description: 'Single-use setup token provided in the administrator invitation',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    example: 'SecureAdminPassword2026!',
    description:
      'New password for the administrator account (8–128 characters, upper and lowercase letters, and at least one number or special character)',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9\W_]).+$/, {
    message:
      'Password must contain uppercase and lowercase letters, and at least one number or special character',
  })
  newPassword: string;
}

