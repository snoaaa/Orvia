import { ApiProperty } from '@nestjs/swagger';

/** One permission code that roles are built from (Section 4.5). */
export class PermissionEntity {
  @ApiProperty({
    example: '3f2b8c1a-6d4e-4f5a-9b7c-1e2d3f4a5b6c',
    description: 'Permission id, usable as an entry of `permissionIds` in PATCH /roles/{id}',
  })
  id: string;

  @ApiProperty({ example: 'users:invite', description: 'Unique permission code, `<category>:<action>`' })
  code: string;

  @ApiProperty({ example: 'Send invitations to new users', description: 'What the permission allows', nullable: true })
  description: string | null;

  @ApiProperty({ example: 'users', description: 'Category: the part of the code before the colon' })
  category: string;

  constructor(partial: Partial<PermissionEntity>) {
    Object.assign(this, partial);
  }
}
