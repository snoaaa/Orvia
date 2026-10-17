import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSpaceDto {
  @ApiProperty({ example: 'Operating Systems & Architecture', description: 'Space name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Course materials, slide decks, and exam prep', description: 'Space description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174001', description: 'School UUID if associated with school' })
  @IsString()
  @IsOptional()
  schoolId?: string;

  @ApiPropertyOptional({ example: 'en', default: 'en', description: 'Language' })
  @IsString()
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({ example: 'public', default: 'public', description: 'Privacy level (public, private, restricted)' })
  @IsString()
  @IsOptional()
  privacy?: string;
}
