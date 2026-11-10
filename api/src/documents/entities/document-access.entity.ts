import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DocumentAccessEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'Rule UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174010', description: 'Document UUID' })
  documentId: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174001', description: 'Target school UUID' })
  schoolId: string | null;

  @ApiPropertyOptional({ example: 'student', description: 'Target role name or role UUID' })
  roleId: string | null;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174002', description: 'Target group or class UUID' })
  groupId: string | null;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<DocumentAccessEntity>) {
    Object.assign(this, partial);
  }
}
