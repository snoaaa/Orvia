import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const QUESTION_MAX_LENGTH = 4000;
export const QUESTION_MAX_SPACES = 10;

/**
 * A question asked in a conversation (#119, spec §4.2): body of `POST /conversations/{id}/messages`.
 * The conversation is the `{id}` of the route. Nothing else is accepted: the client never chooses the
 * role, the model or its parameters.
 */
export class AskQuestionDto {
  @ApiProperty({
    example: 'How does backpropagation use the chain rule?',
    description: 'The question, trimmed',
    minLength: 1,
    maxLength: QUESTION_MAX_LENGTH,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(QUESTION_MAX_LENGTH)
  question: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    example: ['123e4567-e89b-12d3-a456-426614174011'],
    maxItems: QUESTION_MAX_SPACES,
    description:
      'Search only these spaces. Left out: the space of the conversation. Spaces the caller may not see never ' +
      'contribute to the answer.',
  })
  // UUIDs are case-insensitive: lowercased first, so the same space in two cases counts as a repeat.
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map((id) => (typeof id === 'string' ? id.toLowerCase() : id)) : value,
  )
  @IsArray()
  @ArrayMaxSize(QUESTION_MAX_SPACES)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  @IsOptional()
  spaceIds?: string[];
}
