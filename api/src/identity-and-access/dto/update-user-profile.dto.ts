import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const email = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** Body of PATCH /users/:id (#40). At least one field is required; the status is changed by suspend/reactivate. */
export class UpdateUserProfileDto {
  @ApiPropertyOptional({ example: 'Jane M. Doe', description: 'New full name', maxLength: 191 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  @IsOptional()
  fullName?: string;

  @ApiPropertyOptional({
    example: 'jane.doe@school.edu',
    description: "New email; must match the allowed domains of the user's schools and not be used by someone else",
    maxLength: 191,
  })
  @Transform(email)
  @IsEmail()
  @MaxLength(191)
  @IsOptional()
  email?: string;
}
