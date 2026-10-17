import { ApiProperty } from '@nestjs/swagger';

export class RetrievedPassageEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174023', description: 'Passage UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174021', description: 'Message UUID' })
  messageId: string;

  @ApiProperty({ example: 'pinecone-chunk-uuid-98765', description: 'External chunk ID from vector store (no FK)' })
  chunkId: string;

  @ApiProperty({ example: 0.892, description: 'Cosine or hybrid similarity score' })
  score: number;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<RetrievedPassageEntity>) {
    Object.assign(this, partial);
  }
}
