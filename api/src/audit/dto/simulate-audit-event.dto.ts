import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

/**
 * Body of the DEV-ONLY simulation endpoints (AUDIT_DEV_TOOLS=true).
 * `password` and `refreshToken` are accepted on purpose, to show they never reach the audit row.
 */
export class SimulateAuditEventDto {
  @ApiPropertyOptional({ example: 'jane.doe@school.edu' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: 'WrongPassword!1', description: 'Must NOT appear in the stored event' })
  @IsString()
  @IsOptional()
  password?: string;

  @ApiPropertyOptional({ example: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln', description: 'Must NOT appear in the stored event' })
  @IsString()
  @IsOptional()
  refreshToken?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'User acting / affected' })
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({ example: 'PLATFORM_ADMIN' })
  @IsString()
  @IsOptional()
  role?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174099' })
  @IsString()
  @IsOptional()
  sessionId?: string;
}
