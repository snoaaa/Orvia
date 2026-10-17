import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'User UUID' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ example: 'android', description: 'Platform OS (ios, android, web)' })
  @IsString()
  @IsIn(['ios', 'android', 'web'])
  platform: string;
}
