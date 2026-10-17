import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateConversationDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'User UUID initiating conversation' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174011', description: 'Target document space UUID' })
  @IsString()
  @IsNotEmpty()
  spaceId: string;

  @ApiProperty({ example: 'Understanding Gradient Descent & Momentum', description: 'Initial conversation topic/title' })
  @IsString()
  @IsNotEmpty()
  title: string;
}
