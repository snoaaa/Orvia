import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Query of GET /assignments/assignable-roles (#47). */
export class ListAssignableRolesQueryDto {
  @ApiPropertyOptional({
    example: '123e4567-e89b-12d3-a456-426614174001',
    description: 'Only count the roles you hold in this school (and platform roles). 403 for a school outside your scope.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  schoolId?: string;
}
