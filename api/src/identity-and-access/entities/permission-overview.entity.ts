import { ApiProperty } from '@nestjs/swagger';

export class PermissionHolderEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  userId: string;

  @ApiProperty({ example: 'jane.doe@school.edu' })
  email: string;

  @ApiProperty({ example: 'Jane Doe' })
  fullName: string;

  @ApiProperty({ example: 'ACTIVE', enum: ['INVITED', 'ACTIVE', 'SUSPENDED'] })
  status: string;

  @ApiProperty({ example: 'SCHOOL_ADMIN', description: 'Role that grants the permission' })
  role: string;

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

  @ApiProperty({ type: [PermissionHolderEntity], description: 'Users holding it (scoped to your schools)' })
  holders: PermissionHolderEntity[];

  constructor(partial: PermissionOverviewEntity) {
    Object.assign(this, partial);
  }
}
