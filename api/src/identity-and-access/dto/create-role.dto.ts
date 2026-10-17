import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'ADMIN_PLATFORM', description: 'Unique role name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'platform', description: 'Scope (platform, school, group)' })
  @IsString()
  @IsNotEmpty()
  scope: string;
}
