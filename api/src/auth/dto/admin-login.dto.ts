import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
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
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: 'wamdp_admin_2026!',
    description: 'Administrator password (minimum 8 characters)',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Optional registered device UUID for session binding',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}
