import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class UpdateRoleDto {
  @ApiPropertyOptional({ example: 'TEACHING_ASSISTANT', description: 'Unique role name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'school', description: 'Scope (platform, school, group)' })
  @IsString()
  @IsOptional()
  scope?: string;

  @ApiPropertyOptional({ example: ['documents:read', 'conversations:create'], description: 'List of permission codes' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  permissions?: string[];
}

