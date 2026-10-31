import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Request payload for administrator login (Issue #8).
 * Only platform administrators and school administrators use email and password authentication.
 */
export class AdminLoginDto {
  @ApiProperty({
    example: 'admin@wamdp.platform',
    description: 'Administrator email address',
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
    example: 'wamdp_admin_2026!',
    description: 'Administrator password (8 to 128 characters)',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Optional registered device UUID for session binding',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}
