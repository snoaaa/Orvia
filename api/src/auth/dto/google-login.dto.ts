import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Request payload for Google OAuth 2.0 / OpenID Connect login (Issue #10).
 *
 * The client application performs the OAuth flow with Google and passes the
 * received Google ID token (`idToken`) to this endpoint for cryptographic verification.
 */
export class GoogleLoginDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEifQ...',
    description:
      'Google OpenID Connect ID token obtained by the client (web or mobile). ' +
      'Verified server-side for signature, issuer, audience, expiry, and email_verified.',
    maxLength: 4096,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  idToken: string;

  @ApiPropertyOptional({
    description: 'Unique client device identifier to bind the session to for device tracking and revocation',
    example: 'd8c3683a-86c2-4a0b-9309-880629707920',
  })
  @IsUUID()
  @IsOptional()
  deviceId?: string;
}
