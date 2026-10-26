import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class DevTokenDto {
  @ApiProperty({ example: 'admin@wamdp.platform', description: 'Email of an existing user' })
  @IsEmail()
  email: string;
}
