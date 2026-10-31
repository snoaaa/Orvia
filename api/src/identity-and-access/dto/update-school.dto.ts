import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSchoolDto {
  @ApiPropertyOptional({
    example: 'Polytechnic Engineering Institute of Technology',
    description: 'Updated school name (must be unique)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    example: { maxUsers: 1500, features: ['rag', 'offline'], contactEmail: 'admin@polytechnic.edu' },
    description: 'Updated school settings (JSON object)',
  })
  @IsObject({ message: 'settings must be an object' })
  @IsOptional()
  settings?: Record<string, unknown>;
}

