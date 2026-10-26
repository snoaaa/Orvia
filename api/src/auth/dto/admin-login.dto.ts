import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * Request body for admin login (Issue #8).
 * Only platform / school admins use email + password; regular users authenticate via Google.
 */
export class AdminLoginDto {
  @ApiProperty({
    example: 'admin@wamdp.platform',
    description: 'Admin email address',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: 'SuperSecret2026!',
    description: 'Admin password (min 8 characters)',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;
}
