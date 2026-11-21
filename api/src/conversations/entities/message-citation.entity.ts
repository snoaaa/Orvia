import { ApiProperty } from '@nestjs/swagger';

/**
 * Zone of a citation on its page or image (#119): a rectangle given as fractions of the page, from its
 * top-left corner, so it can be drawn at any display size. `x + width` and `y + height` are at most 1.
 */
export class CitationZoneEntity {
  @ApiProperty({ example: 0.1, minimum: 0, maximum: 1, description: 'Left edge, as a fraction of the page width' })
  x: number;

  @ApiProperty({ example: 0.42, minimum: 0, maximum: 1, description: 'Top edge, as a fraction of the page height' })
  y: number;

  @ApiProperty({ example: 0.8, minimum: 0, maximum: 1, description: 'Width, as a fraction of the page width' })
  width: number;

  @ApiProperty({ example: 0.12, minimum: 0, maximum: 1, description: 'Height, as a fraction of the page height' })
  height: number;

  constructor(partial: CitationZoneEntity) {
    Object.assign(this, partial);
  }
}

/**
 * A source of an assistant answer (#119). The answer text points to it with its marker: `[1]` is the
 * citation whose `marker` is 1. `available` is false once the cited document is deleted or the cited
 * version is no longer available; the citation is still returned so the answer keeps making sense.
 */
export class MessageCitationEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174022', description: 'Citation UUID' })
  id: string;

  @ApiProperty({ example: 1, minimum: 1, description: 'Number of the citation in the answer text: `[1]` refers to marker 1' })
  marker: number;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174010', description: 'Cited document UUID' })
  documentId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174012', description: 'Cited document version UUID' })
  versionId: string;

  @ApiProperty({ example: 'Neural Networks Lecture 4', description: 'Title of the cited document' })
  documentName: string;

  @ApiProperty({ example: 2, description: 'Number of the cited version' })
  versionNumber: number;

  @ApiProperty({ example: 'page_14', description: 'Page (`page_<n>`) or image identifier inside the cited version' })
  pageOrImageId: string;

  @ApiProperty({
    example: 'The chain rule applied to composite activation functions yields the gradient of each layer.',
    description: 'Passage of the source that supports the answer',
  })
  excerpt: string;

  @ApiProperty({
    type: () => CitationZoneEntity,
    nullable: true,
    description: 'Where the excerpt is on the page or image; null when unknown',
  })
  zone: CitationZoneEntity | null;

  @ApiProperty({
    example: true,
    description: 'False when the cited document was deleted or the cited version is no longer available',
  })
  available: boolean;

  constructor(partial: Partial<MessageCitationEntity>) {
    Object.assign(this, partial);
  }
}
