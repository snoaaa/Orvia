import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateMessageDto {
  @ApiProperty({ example: 'user', description: 'Message sender role (user, assistant, system)' })
  @IsString()
  @IsNotEmpty()
  role: string;

  @ApiProperty({ example: 'Can you explain how backpropagation applies the chain rule?', description: 'Prompt or response content' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ example: 'gpt-4o', description: 'Model identifier' })
  @IsString()
  @IsOptional()
  modelUsed?: string;

  @ApiPropertyOptional({ example: { temperature: 0.2 }, description: 'Inference hyper-parameters' })
  @IsOptional()
  parameters?: Record<string, unknown>;
}
