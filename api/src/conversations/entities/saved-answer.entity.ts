import { ApiProperty } from '@nestjs/swagger';

export class SavedAnswerEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174024', description: 'Saved answer UUID' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'User UUID' })
  userId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174021', description: 'Message UUID' })
  messageId: string;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<SavedAnswerEntity>) {
    Object.assign(this, partial);
  }
}
