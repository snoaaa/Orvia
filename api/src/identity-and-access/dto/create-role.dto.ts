import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'TEACHING_ASSISTANT', description: 'Unique role name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'school', description: 'Scope (platform, school, group)' })
  @IsString()
  @IsNotEmpty()
  scope: string;

  @ApiPropertyOptional({ example: ['documents:read', 'conversations:create'], description: 'List of permission codes' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  permissions?: string[];
}
