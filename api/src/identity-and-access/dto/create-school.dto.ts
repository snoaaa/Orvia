import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSchoolDto {
  @ApiProperty({ example: 'Polytechnic Engineering Institute', description: 'School name (must be unique)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name: string;

  @ApiPropertyOptional({ example: { maxUsers: 1000, theme: 'dark' }, description: 'School settings (JSON object)' })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'active', description: 'School status', default: 'active' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    example: 'polytechnic.edu,eng.polytechnic.edu',
    description: 'Allowed email domains (comma-separated)',
  })
  @IsOptional()
  @IsString()
  allowedDomains?: string;
}
