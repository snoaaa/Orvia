import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateDocumentDto {
  @ApiPropertyOptional({ example: 'Lecture Notes - Advanced Algorithms (Rev 2)', description: 'Updated document title' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Prof. Donald Knuth', description: 'Updated author' })
  @IsString()
  @IsOptional()
  author?: string;

  @ApiPropertyOptional({ example: 'algorithms,cs,graphs,sorting', description: 'Updated tags' })
  @IsString()
  @IsOptional()
  tags?: string;

  @ApiPropertyOptional({ example: { format: 'pdf', pages: 35 }, description: 'Updated metadata' })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
