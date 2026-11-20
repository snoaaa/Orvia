import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const REPORT_REASONS = ['hallucination', 'toxic', 'incorrect_citation', 'irrelevant', 'incomplete', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Body of POST /conversations/reports (#125). Caller identity comes from the JWT (`@CurrentUser()`). */
export class ReportAnswerDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174021', description: 'Assistant message UUID to report' })
  @IsUUID('all')
  @IsNotEmpty()
  messageId: string;

  @ApiProperty({ enum: REPORT_REASONS, example: 'hallucination', description: 'Report category' })
  @Transform(trimmed)
  @IsIn(REPORT_REASONS)
  reason: ReportReason;

  @ApiPropertyOptional({ example: 'Incorrect mathematical derivation on step 3', maxLength: 2000, description: 'Optional explanation' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  feedback?: string;
}
