import { ApiProperty } from '@nestjs/swagger';

export class SyncChangeEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174043', description: 'Change log UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'User UUID' })
  userId: string;

  @ApiProperty({ example: 'document', description: 'Affected entity type' })
  entityType: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174010', description: 'Target entity UUID' })
  entityId: string;

  @ApiProperty({ example: 'update', description: 'Operation (insert, update, delete)' })
  operation: string;

  @ApiProperty({ example: 3, description: 'Version sequence number' })
  version: number;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<SyncChangeEntity>) {
    Object.assign(this, partial);
  }
}
