import { ApiProperty } from '@nestjs/swagger';

export class DeviceEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174040', description: 'Device UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'User UUID' })
  userId: string;

  @ApiProperty({ example: 'android', description: 'Device platform (ios, android, web)' })
  platform: string;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last sync timestamp' })
  lastSyncAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<DeviceEntity>) {
    Object.assign(this, partial);
  }
}
