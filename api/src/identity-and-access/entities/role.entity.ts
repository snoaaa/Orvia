import { ApiProperty } from '@nestjs/swagger';

export class RoleEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174002', description: 'Unique role identifier (UUID)' })
  id: string;

  @ApiProperty({ example: 'ADMIN_PLATFORM', description: 'Role name' })
  name: string;

  @ApiProperty({ example: 'platform', description: 'Scope of the role (platform, school, group)' })
  scope: string;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<RoleEntity>) {
    Object.assign(this, partial);
  }
}
