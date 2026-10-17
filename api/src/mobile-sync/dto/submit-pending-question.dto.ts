import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SubmitPendingQuestionDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174040', description: 'Device UUID' })
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174020', description: 'Target conversation UUID' })
  @IsString()
  @IsNotEmpty()
  conversationId: string;

  @ApiProperty({ example: 'Could you give an intuition on cross-entropy loss?', description: 'Queued question' })
  @IsString()
  @IsNotEmpty()
  content: string;
}
