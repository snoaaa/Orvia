import { ApiProperty } from '@nestjs/swagger';

export class SchoolEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001', description: 'Unique school identifier (UUID)' })
  id: string;

  @ApiProperty({ example: 'Polytechnic Engineering Institute', description: 'School or university name' })
  name: string;

  @ApiProperty({ example: 'polytechnic.edu,eng.polytechnic.edu', description: 'Comma-separated allowed domains' })
  allowedDomains: string;

  @ApiProperty({ example: 'active', description: 'School status' })
  status: string;

  @ApiProperty({ example: { maxUsers: 500, features: ['rag', 'offline'] }, description: 'School settings (JSON)' })
  settings: Record<string, unknown> | null;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<SchoolEntity>) {
    Object.assign(this, partial);
  }
}
