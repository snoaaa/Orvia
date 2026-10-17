import { ApiProperty } from '@nestjs/swagger';

export class SessionEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174004', description: 'Unique session identifier (UUID)' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'Associated user identifier (UUID)' })
  userId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174005', required: false, description: 'Associated device identifier (UUID)' })
  deviceId?: string | null;

  @ApiProperty({ example: '2026-10-18T12:00:00.000Z', description: 'Session expiration date' })
  expiresAt: Date;

  @ApiProperty({ example: null, required: false, description: 'Revocation timestamp if revoked' })
  revokedAt?: Date | null;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<SessionEntity>) {
    Object.assign(this, partial);
  }
}
