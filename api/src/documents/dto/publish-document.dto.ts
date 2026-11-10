import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

export class DocumentAccessRuleItemDto {
  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'Target school UUID (optional)' })
  @IsOptional()
  @IsUUID()
  schoolId?: string;

  @ApiPropertyOptional({ example: 'student', description: 'Target role name or role UUID (optional)' })
  @IsOptional()
  @IsString()
  roleId?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174001', description: 'Target group or class UUID (optional)' })
  @IsOptional()
  @IsUUID()
  groupId?: string;
}

export class PublishDocumentDto {
  @ApiProperty({
    type: [DocumentAccessRuleItemDto],
    description: 'List of access rules specifying which schools, roles, or groups can view this document',
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'At least one access rule must be provided' })
  @ValidateNested({ each: true })
  @Type(() => DocumentAccessRuleItemDto)
  rules: DocumentAccessRuleItemDto[];
}
