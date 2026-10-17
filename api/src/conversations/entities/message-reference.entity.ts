import { ApiProperty } from '@nestjs/swagger';

export class MessageReferenceEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174022', description: 'Reference UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174021', description: 'Message UUID' })
  messageId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174012', description: 'Document version UUID' })
  documentVersionId: string;

  @ApiProperty({ example: 'page_14', description: 'Page or image citation identifier' })
  pageOrImageId: string;

  @ApiProperty({ example: 'The chain rule applied to composite activation functions yields...', description: 'Quoted citation excerpt' })
  excerpt: string;

  @ApiProperty({ example: '{"x1": 50, "y1": 120, "x2": 450, "y2": 180}', description: 'Bounding box coordinates' })
  coordinates: string;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<MessageReferenceEntity>) {
    Object.assign(this, partial);
  }
}
