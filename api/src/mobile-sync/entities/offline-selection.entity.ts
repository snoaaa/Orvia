import { ApiProperty } from '@nestjs/swagger';

export class OfflineSelectionEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174041', description: 'Selection UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174040', description: 'Device UUID' })
  deviceId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174011', required: false, description: 'Space UUID' })
  spaceId?: string | null;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174010', required: false, description: 'Document UUID' })
  documentId?: string | null;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<OfflineSelectionEntity>) {
    Object.assign(this, partial);
  }
}
