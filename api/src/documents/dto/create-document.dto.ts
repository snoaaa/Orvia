import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateDocumentDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174011', description: 'Space UUID to add this document to' })
  @IsString()
  @IsNotEmpty()
  spaceId: string;

  @ApiProperty({ example: 'Lecture Notes - Advanced Algorithms', description: 'Document title' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'https://storage.wamdp.internal/docs/algos.pdf', description: 'Document URL or storage path' })
  @IsString()
  @IsNotEmpty()
  url: string;

  @ApiPropertyOptional({ example: 'Prof. Donald Knuth', description: 'Author or lecturer' })
  @IsString()
  @IsOptional()
  author?: string;

  @ApiPropertyOptional({ example: 'algorithms,cs,graphs', description: 'Comma-separated tags' })
  @IsString()
  @IsOptional()
  tags?: string;

  @ApiPropertyOptional({ example: { format: 'pdf', pages: 30 }, description: 'Arbitrary document metadata' })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
