import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'Unique user identifier (UUID)' })
  id: string;

  @ApiProperty({ example: 'user@school.edu', description: 'User primary email address' })
  email: string;

  @ApiProperty({ example: 'John Doe', description: 'Full name of the user' })
  fullName: string;

  @ApiProperty({ example: 'local', description: 'Authentication provider (local, google, etc.)' })
  authProvider: string;

  @ApiProperty({ example: 'INVITED', enum: ['INVITED', 'ACTIVE', 'SUSPENDED'], description: 'Account status (INVITED, ACTIVE, SUSPENDED)' })
  status: string;

  @ApiPropertyOptional({
    example: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    description: 'Single-use setup token for invited administrators to set their first password (Issue #26)',
  })
  setupToken?: string | null;

  @ApiPropertyOptional({
    example: '2026-11-01T12:00:00.000Z',
    description: 'Expiration timestamp for the administrator password setup token',
  })
  setupTokenExpiresAt?: Date | null;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-17T12:00:00.000Z', description: 'Last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<UserEntity>) {
    Object.assign(this, partial);
  }
}
