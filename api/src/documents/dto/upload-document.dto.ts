import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadDocumentDto {
  @ApiPropertyOptional({
    example: 'Machine Learning Lecture Notes',
    description: 'Document title (defaults to filename without extension if omitted)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({
    example: 'Prof. Turing',
    description: 'Author or lecturer name (defaults to caller full name)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  author?: string;

  @ApiPropertyOptional({
    example: 'ml,neural-networks,ai',
    description: 'Comma-separated tags for search and categorization',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  tags?: string;
}
