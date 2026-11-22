import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { ROLE_SCOPES, type RoleScope } from './create-role.dto.js';

/**
 * Body of `PATCH /roles/:id` (#45): change a custom role's name, scope and/or permission set.
 *
 * Every field is optional, but at least one must be sent (the service answers 400 otherwise, before
 * anything is written). `permissions` and `permissionIds` are two spellings of the same replacement
 * set — permission codes (what `GET /roles` returns) or permission ids (what `GET /permissions`
 * returns) — and cannot be combined; an empty array makes the role grant nothing.
 */
export class UpdateRoleDto {
  @ApiPropertyOptional({
    example: 'TEACHING_ASSISTANT',
    description:
      'New unique name, 2-50 letters, digits, _ or -. Stored in upper case; must not be a base role name',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(2, 50)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'name may only contain letters, digits, _ and -' })
  name?: string;

  @ApiPropertyOptional({ enum: ROLE_SCOPES, example: 'school', description: 'New documentary scope of the role' })
  @IsOptional()
  @IsIn(ROLE_SCOPES)
  scope?: RoleScope;

  @ApiPropertyOptional({
    type: [String],
    example: ['documents:read', 'conversations:create'],
    description:
      'Permission codes the role should grant, replacing the current set (from GET /roles). Cannot be sent with permissionIds',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @Matches(/\S/, { each: true, message: 'permission codes must not be blank' })
  permissions?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['8f1d3d1e-0a1c-4d3b-9c4e-0e2f1a5b6c7d'],
    description:
      'Permission ids the role should grant, replacing the current set (from GET /permissions). Cannot be sent with permissions',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  permissionIds?: string[];
}
