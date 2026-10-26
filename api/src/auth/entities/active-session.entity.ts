import { ApiProperty } from '@nestjs/swagger';

export class SessionDeviceEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174040' })
  id: string;

  @ApiProperty({ example: 'android' })
  platform: string;

  @ApiProperty({ example: '2026-10-18T12:00:00.000Z' })
  lastSyncAt: Date;
}

export class ActiveSessionEntity {
  @ApiProperty({ example: '0b5dd953-8dac-48d7-84b8-ffca498c41ba' })
  id: string;

  @ApiProperty({ example: true, description: 'The session of the token making this request' })
  current: boolean;

  @ApiProperty({ type: SessionDeviceEntity, nullable: true })
  device: SessionDeviceEntity | null;

  @ApiProperty({ example: '192.168.1.20', nullable: true })
  ip: string | null;

  @ApiProperty({ example: 'Mozilla/5.0 (Linux; Android 14)', nullable: true })
  userAgent: string | null;

  @ApiProperty({ example: '2026-10-18T12:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-18T12:30:00.000Z', nullable: true })
  lastUsedAt: Date | null;

  @ApiProperty({ example: '2026-11-17T12:00:00.000Z' })
  expiresAt: Date;

  static from(
    row: {
      id: string;
      ip: string | null;
      userAgent: string | null;
      createdAt: Date;
      lastUsedAt: Date | null;
      expiresAt: Date;
      device: { id: string; platform: string; lastSyncAt: Date } | null;
    },
    currentSessionId: string | null,
  ): ActiveSessionEntity {
    return Object.assign(new ActiveSessionEntity(), {
      id: row.id,
      current: row.id === currentSessionId,
      device: row.device ? { id: row.device.id, platform: row.device.platform, lastSyncAt: row.device.lastSyncAt } : null,
      ip: row.ip,
      userAgent: row.userAgent,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
    });
  }
}
