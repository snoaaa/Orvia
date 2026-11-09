import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/** Documentary scopes a role can have (Section 4.5 / 4.7), as used by the seeded base roles. */
export const ROLE_SCOPES = ['platform', 'school', 'group'] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

/** POST /roles (#44). Same rules as the web role editor, so the two never disagree. */
export class CreateRoleDto {
  @ApiProperty({
    example: 'TEACHING_ASSISTANT',
    description: 'Unique role name, 2-50 letters, digits, _ or -. Stored in upper case; must not be a base role name',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 50)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'name may only contain letters, digits, _ and -' })
  name: string;

  @ApiProperty({ example: 'school', enum: ROLE_SCOPES, description: 'Documentary scope of the role' })
  @IsIn(ROLE_SCOPES)
  scope: RoleScope;

  @ApiProperty({
    example: ['documents:read', 'conversations:create'],
    description: 'Permission codes granted by the role, as returned by GET /permissions',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  permissions: string[];
}
