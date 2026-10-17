import { ApiProperty } from '@nestjs/swagger';

export class GroupEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174003', description: 'Unique group identifier (UUID)' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001', description: 'Associated school identifier (UUID)' })
  schoolId: string;

  @ApiProperty({ example: 'Class 4-ISI-A', description: 'Group name' })
  name: string;

  @ApiProperty({ example: 'class', description: 'Group type (class, department, team)' })
  type: string;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<GroupEntity>) {
    Object.assign(this, partial);
  }
}
