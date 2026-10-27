import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Request body for Google OAuth 2.0 / OpenID Connect login (Issue #10).
 * The client obtains an ID token from Google and sends it here for server-side verification.
 */
export class GoogleLoginDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEifQ...',
    description:
      'Google OpenID Connect ID token obtained by the client ' +
      '(e.g. via google-signin or Sign In With Google). ' +
      'The server verifies signature, issuer, audience, expiry, and email_verified.',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
