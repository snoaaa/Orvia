import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export const CONVERSATION_TITLE_MAX_LENGTH = 191;

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Body of PATCH /conversations/:id (#124). */
export class UpdateConversationDto {
  @ApiProperty({
    example: 'Quantum Mechanics — Wave-Particle Duality',
    description: 'New conversation title (trimmed, 1-191 characters)',
    maxLength: CONVERSATION_TITLE_MAX_LENGTH,
  })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CONVERSATION_TITLE_MAX_LENGTH)
  title: string;
}
