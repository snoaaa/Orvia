import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'john.doe@school.edu', description: 'User corporate or university email' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'John Doe', description: 'Full name' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiPropertyOptional({ example: 'password123#', description: 'Optional initial password for local auth' })
  @IsString()
  @IsOptional()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({ example: 'local', default: 'local', description: 'Auth provider (local, google)' })
  @IsString()
  @IsOptional()
  authProvider?: string;

  @ApiPropertyOptional({
    example: '123e4567-e89b-12d3-a456-426614174001',
    description: 'School the user is invited into: the user is assigned to it with `role`',
  })
  @IsString()
  @IsOptional()
  schoolId?: string;

  @ApiPropertyOptional({
    example: 'STUDENT',
    default: 'STUDENT',
    description: 'Role in that school (requires schoolId). Platform roles can only be given by a platform admin.',
  })
  @IsString()
  @IsOptional()
  role?: string;
}
