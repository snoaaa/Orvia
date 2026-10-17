import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SaveAnswerDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'User UUID saving the answer' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174021', description: 'Message UUID containing the answer' })
  @IsString()
  @IsNotEmpty()
  messageId: string;
}
