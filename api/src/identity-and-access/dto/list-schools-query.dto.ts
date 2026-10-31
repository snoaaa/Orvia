import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListSchoolsQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, description: 'Page number (minimum 1)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ example: 10, default: 10, description: 'Items per page (1-100)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ example: 'active', description: 'Filter schools by status (e.g. active, inactive)' })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: 'Polytechnic', description: 'Search schools by name' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;
}
