import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class UpdateDocumentDto {
  @ApiPropertyOptional({ example: 'Lecture Notes - Advanced Algorithms (Rev 2)', description: 'Updated document title' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Prof. Donald Knuth', description: 'Updated author' })
  @IsString()
  @IsOptional()
  author?: string;

  @ApiPropertyOptional({ example: '2026-10-15T09:00:00.000Z', description: 'Updated document date (ISO 8601 string)' })
  @IsISO8601()
  @IsOptional()
  date?: string;

  @ApiPropertyOptional({ example: 'algorithms,cs,graphs,sorting', description: 'Updated tags' })
  @IsString()
  @IsOptional()
  tags?: string;

  @ApiPropertyOptional({ example: { format: 'pdf', pages: 35 }, description: 'Updated metadata' })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
