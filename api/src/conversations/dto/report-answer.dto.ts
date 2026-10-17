import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReportAnswerDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'User UUID submitting report' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174021', description: 'Target message UUID' })
  @IsString()
  @IsNotEmpty()
  messageId: string;

  @ApiProperty({ example: 'hallucination', description: 'Report category (hallucination, toxic, incorrect_citation)' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({ example: 'Incorrect mathematical derivation on step 3', description: 'Detailed feedback' })
  @IsString()
  @IsOptional()
  feedback?: string;
}
