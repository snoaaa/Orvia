import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAuditEventDto {
  @ApiProperty({ example: 'AUTH', description: 'Category (AUTH, IAM, DOCUMENT, RAG, SYSTEM)' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ example: 'USER_LOGIN_SUCCESS', description: 'Action performed' })
  @IsString()
  @IsNotEmpty()
  action: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'Actor user UUID' })
  @IsString()
  @IsOptional()
  actorId?: string;

  @ApiProperty({ example: 'ADMIN_PLATFORM', description: 'Actor role' })
  @IsString()
  @IsNotEmpty()
  actorRole: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174001', description: 'School UUID' })
  @IsString()
  @IsOptional()
  schoolId?: string;

  @ApiProperty({ example: 'user', description: 'Target entity type' })
  @IsString()
  @IsNotEmpty()
  entityType: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'Target entity UUID' })
  @IsString()
  @IsNotEmpty()
  entityId: string;

  @ApiProperty({ example: '127.0.0.1', description: 'Client IP address' })
  @IsString()
  @IsNotEmpty()
  ip: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174040', description: 'Device UUID' })
  @IsString()
  @IsOptional()
  deviceId?: string;

  @ApiPropertyOptional({ example: { reason: 'manual_verification' }, description: 'Additional event metadata' })
  @IsOptional()
  details?: Record<string, unknown>;
}
