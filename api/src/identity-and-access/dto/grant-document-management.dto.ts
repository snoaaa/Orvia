import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Body of `POST /identity/users/:id/document-management` (§4.5, #88):
 * Grants or revokes document-management rights for a staff member in a specified school.
 */
export class GrantDocumentManagementDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174001',
    description: 'School UUID where document-management permission is granted or revoked',
  })
  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @ApiProperty({
    example: true,
    required: false,
    description: 'Whether document management is granted (true) or revoked (false). Defaults to true.',
  })
  @IsOptional()
  @IsBoolean()
  granted?: boolean;
}

