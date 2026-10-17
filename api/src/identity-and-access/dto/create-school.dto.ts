import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSchoolDto {
  @ApiProperty({ example: 'Polytechnic Engineering Institute', description: 'School name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'polytechnic.edu,eng.polytechnic.edu', description: 'Allowed email domains (comma-separated)' })
  @IsString()
  @IsNotEmpty()
  allowedDomains: string;

  @ApiPropertyOptional({ example: { maxUsers: 1000 }, description: 'School settings' })
  @IsOptional()
  settings?: Record<string, unknown>;
}
