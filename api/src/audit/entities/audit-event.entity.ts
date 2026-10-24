import { ApiProperty } from '@nestjs/swagger';

export class AuditEventEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174050', description: 'Audit event UUID' })
  id: string;

  @ApiProperty({ example: '42', description: 'Insertion order in the hash chain' })
  seq: string;

  @ApiProperty({ example: 'authentication', description: 'Category (authentication, identity_access, security)' })
  category: string;

  @ApiProperty({ example: 'login_success', description: 'Specific action performed' })
  action: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', required: false, nullable: true, description: 'Actor user UUID' })
  actorId: string | null;

  @ApiProperty({ example: 'PLATFORM_ADMIN', required: false, nullable: true, description: 'Actor role at event time' })
  actorRole: string | null;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001', required: false, nullable: true, description: 'School UUID' })
  schoolId: string | null;

  @ApiProperty({ example: 'user', required: false, nullable: true, description: 'Target entity type' })
  entityType: string | null;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', required: false, nullable: true, description: 'Target entity id' })
  entityId: string | null;

  @ApiProperty({ example: '192.168.1.100', required: false, nullable: true, description: 'Client IP address' })
  ip: string | null;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174040', required: false, nullable: true, description: 'Origin device id' })
  deviceId: string | null;

  @ApiProperty({ example: { method: 'password', userAgent: 'Mozilla/5.0...' }, description: 'Structured details (never contains secrets)' })
  details: Record<string, unknown>;

  @ApiProperty({ example: '0000000000000000000000000000000000000000000000000000000000000000', description: 'Hash of the previous event' })
  prevHash: string;

  @ApiProperty({ example: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90', description: 'SHA-256 of this event, including prevHash' })
  hash: string;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  constructor(partial: Partial<AuditEventEntity>) {
    Object.assign(this, partial);
  }
}
