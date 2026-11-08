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

  @ApiPropertyOptional({
    example: 'polytechnic.edu,yahoo.org',
    description:
      'Replaces the allowed email domains (comma-separated, lowercased). Emails from these domains ' +
      '(or their subdomains) may be invited and may sign in with Google. An empty value clears the ' +
      'list, which means the school restricts nothing.',
  })
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  allowedDomains?: string;
}

