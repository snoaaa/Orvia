import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    example: '0b5dd953-8dac-48d7-84b8-ffca498c41ba.Xq3...base64url-secret',
    description: 'Refresh token received at login or at the previous refresh',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  refreshToken: string;
}
