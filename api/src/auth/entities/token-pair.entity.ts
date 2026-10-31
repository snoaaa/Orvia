import { ApiProperty } from '@nestjs/swagger';

export class TokenPairEntity {
  @ApiProperty({ description: 'Short-lived access token (send as Authorization: Bearer)' })
  accessToken: string;

  @ApiProperty({ description: 'New refresh token: the previous one no longer works' })
  refreshToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({ example: 900, description: 'Access token lifetime in seconds' })
  expiresIn: number;

  @ApiProperty({ example: '0b5dd953-8dac-48d7-84b8-ffca498c41ba' })
  sessionId: string;

  @ApiProperty({ example: '2026-11-17T12:00:00.000Z', description: 'End of the session (not extended by refreshing)' })
  refreshExpiresAt: Date;
}
