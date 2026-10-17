import { ApiProperty } from '@nestjs/swagger';

export class UserEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'Unique user identifier (UUID)' })
  id: string;

  @ApiProperty({ example: 'user@school.edu', description: 'User primary email address' })
  email: string;

  @ApiProperty({ example: 'John Doe', description: 'Full name of the user' })
  fullName: string;

  @ApiProperty({ example: 'local', description: 'Authentication provider (local, google, etc.)' })
  authProvider: string;

  @ApiProperty({ example: 'active', description: 'Account status (active, invited, suspended)' })
  status: string;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<UserEntity>) {
    Object.assign(this, partial);
  }
}
