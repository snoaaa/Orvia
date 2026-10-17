import { ApiProperty } from '@nestjs/swagger';

export class AuditEventEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174050', description: 'Audit log UUID' })
  id: string;

  @ApiProperty({ example: 'AUTH', description: 'Category (AUTH, IAM, DOCUMENT, RAG, SYSTEM)' })
  category: string;

  @ApiProperty({ example: 'USER_LOGIN_SUCCESS', description: 'Specific action performed' })
  action: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', required: false, description: 'Actor user UUID' })
  actorId?: string | null;

  @ApiProperty({ example: 'ADMIN_PLATFORM', description: 'Actor role at event time' })
  actorRole: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001', required: false, description: 'School UUID' })
  schoolId?: string | null;

  @ApiProperty({ example: 'user', description: 'Target entity type' })
  entityType: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'Target entity UUID' })
  entityId: string;

  @ApiProperty({ example: '192.168.1.100', description: 'IP address of request' })
  ip: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174040', required: false, description: 'Origin device UUID' })
  deviceId?: string | null;

  @ApiProperty({ example: { userAgent: 'Mozilla/5.0...', method: 'POST' }, description: 'Additional structured event details' })
  details: Record<string, unknown>;

  @ApiProperty({ example: '0000000000000000000000000000000000000000000000000000000000000000', description: 'SHA-256 of preceding audit log' })
  prevHash: string;

  @ApiProperty({ example: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90', description: 'SHA-256 hash of this entry' })
  hash: string;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<AuditEventEntity>) {
    Object.assign(this, partial);
  }
}
