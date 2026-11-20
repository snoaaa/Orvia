import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

/** Body of POST /conversations/saved-answers (#125). Caller identity comes from the JWT (`@CurrentUser()`). */
export class SaveAnswerDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174021', description: 'Assistant message UUID to bookmark' })
  @IsUUID('all')
  @IsNotEmpty()
  messageId: string;
}
