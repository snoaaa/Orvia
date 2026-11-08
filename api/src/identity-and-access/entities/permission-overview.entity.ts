import { ApiProperty } from '@nestjs/swagger';

/**
 * One person holding a permission, in one school.
 *
 * Grouped per (user, school): someone who is `SCHOOL_ADMIN` in two schools, or who holds two roles
 * that both grant the same permission, appears **once** — with every granting role in `roles`.
 */
export class PermissionHolderEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  userId: string;

  @ApiProperty({ example: 'jane.doe@school.edu' })
  email: string;

  @ApiProperty({ example: 'Jane Doe' })
  fullName: string;

  @ApiProperty({ example: 'ACTIVE', enum: ['INVITED', 'ACTIVE', 'SUSPENDED'] })
  status: string;

  @ApiProperty({
    type: [String],
    example: ['PLATFORM_ADMIN', 'SCHOOL_ADMIN'],
    description: 'Every role of this user in this school that grants the permission',
  })
  roles: string[];

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001' })
  schoolId: string;

  @ApiProperty({ example: 'Saint Jean Ingénieur' })
  schoolName: string;

  constructor(partial: PermissionHolderEntity) {
    Object.assign(this, partial);
  }
}

export class PermissionOverviewEntity {
  @ApiProperty({ example: 'users:invite' })
  code: string;

  @ApiProperty({ example: 'Send invitations to new users', nullable: true })
  description: string | null;

  @ApiProperty({ example: ['PLATFORM_ADMIN', 'SCHOOL_ADMIN'], description: 'Roles granting this permission' })
  roles: string[];

  @ApiProperty({
    example: 12,
    description: 'Distinct users holding the permission (counted per user and school), scoped to your schools',
  })
  holdersTotal: number;

  @ApiProperty({
    type: [PermissionHolderEntity],
    required: false,
    description:
      'Who holds it. Only returned when the request asks for one permission (`?code=`), capped by `limit`; ' +
      'without `code` only `holdersTotal` is computed so the response stays small.',
  })
  holders?: PermissionHolderEntity[];

  constructor(partial: PermissionOverviewEntity) {
    Object.assign(this, partial);
  }
}
