import { ApiProperty } from '@nestjs/swagger';

/**
 * Citation attached to an assistant message (#119, #123).
 * `available` reflects whether the underlying document is still active and has an available version.
 */
export class MessageCitationEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174022', description: 'Citation reference UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174010', description: 'Source document UUID' })
  documentId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174012', description: 'Cited document version UUID' })
  versionId: string;

  @ApiProperty({ example: 'Neural Networks Lecture 4', description: 'Source document title' })
  documentName: string;

  @ApiProperty({ example: 1, description: 'Cited document version number' })
  versionNumber: number;

  @ApiProperty({ example: 'page_14', description: 'Page or image identifier within the document' })
  pageOrImageId: string;

  @ApiProperty({ example: 'The chain rule applied to composite activation functions yields...', description: 'Quoted citation excerpt' })
  excerpt: string;

  @ApiProperty({ example: '{"x1":50,"y1":120,"x2":450,"y2":180}', nullable: true, description: 'Optional bounding box coordinates' })
  coordinates: string | null;

  @ApiProperty({ example: true, description: 'Whether the cited document is still active and available' })
  available: boolean;

  constructor(partial: Partial<MessageCitationEntity>) {
    Object.assign(this, partial);
  }
}
