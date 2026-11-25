import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ROLE_SCOPES, type RoleScope } from './create-role.dto.js';

/**
 * A field may be absent (leave it alone) but never `null`: `@IsOptional()` skips validation for `null`
 * as well as `undefined`, and the service reads `!== undefined`, so `{ "name": null }` reached `.trim()`
 * and crashed with a 500 while `{ "permissions": null }` silently wiped the set. `@ValidateIf` only skips
 * the other validators when the field is truly missing, so a `null` fails them and answers 400.
 */
const ifPresent = (_object: unknown, value: unknown) => value !== undefined;

/** Codes arrive padded from a copy/paste; trim before `@ArrayUnique()` so the duplicate is caught. */
const trimElements = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item.trim() : item)) : value;

/** UUIDs match case-insensitively in MySQL; normalize case before `@ArrayUnique()` to reject mixed-case duplicates. */
const normalizeUuidElements = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : item))
    : value;

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
  @ValidateIf(ifPresent)
  @IsString()
  @Length(2, 50)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'name may only contain letters, digits, _ and -' })
  name?: string;

  @ApiPropertyOptional({ enum: ROLE_SCOPES, example: 'school', description: 'New documentary scope of the role' })
  @ValidateIf(ifPresent)
  @IsIn(ROLE_SCOPES)
  scope?: RoleScope;

  @ApiPropertyOptional({
    type: [String],
    example: ['documents:read', 'conversations:create'],
    description:
      'Permission codes the role should grant, replacing the current set (from GET /roles). Cannot be sent with permissionIds',
  })
  @Transform(trimElements)
  @ValidateIf(ifPresent)
  @IsArray()
  @ArrayUnique({ message: 'permissions must not contain duplicates (codes are trimmed before comparing)' })
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
  @Transform(normalizeUuidElements)
  @ValidateIf(ifPresent)
  @IsArray()
  @ArrayUnique({ message: 'permissionIds must not contain duplicates' })
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  permissionIds?: string[];
}
