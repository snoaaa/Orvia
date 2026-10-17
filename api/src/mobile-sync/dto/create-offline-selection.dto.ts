import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateOfflineSelectionDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174040', description: 'Device UUID' })
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174011', description: 'Space UUID' })
  @IsString()
  @IsOptional()
  spaceId?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174010', description: 'Document UUID' })
  @IsString()
  @IsOptional()
  documentId?: string;
}
