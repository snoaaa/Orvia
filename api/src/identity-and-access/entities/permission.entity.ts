import { ApiProperty } from '@nestjs/swagger';

/** One permission code that roles are built from (Section 4.5). */
export class PermissionEntity {
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
