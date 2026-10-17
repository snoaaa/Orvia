import { ApiProperty } from '@nestjs/swagger';

export class DocumentEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174010', description: 'Document UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174011', description: 'Space UUID' })
  spaceId: string;

  @ApiProperty({ example: 'Machine Learning Lecture Notes 01', description: 'Document title' })
  title: string;

  @ApiProperty({ example: 'Prof. Turing', description: 'Author or lecturer' })
  author: string;

  @ApiProperty({ example: 'ml,neural-networks,ai', description: 'Comma-separated tags' })
  tags: string;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  @ApiProperty({ example: null, required: false, description: 'Soft deletion timestamp' })
  deletedAt?: Date | null;

  constructor(partial: Partial<DocumentEntity>) {
    Object.assign(this, partial);
  }
}
