import { ApiProperty } from '@nestjs/swagger';

export class SpaceEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174011', description: 'Space UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001', required: false, description: 'School UUID' })
  schoolId?: string | null;

  @ApiProperty({ example: 'Computer Science 2026', description: 'Space name' })
  name: string;

  @ApiProperty({ example: 'Shared study space for Computer Science course', description: 'Description' })
  description: string;

  @ApiProperty({ example: 'en', description: 'Primary language' })
  language: string;

  @ApiProperty({ example: 'public', description: 'Privacy level (public, private, restricted)' })
  privacy: string;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<SpaceEntity>) {
    Object.assign(this, partial);
  }
}
