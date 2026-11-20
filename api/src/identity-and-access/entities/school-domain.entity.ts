import { ApiProperty } from '@nestjs/swagger';

/** An allowed email domain of a school (#32). */
export class SchoolDomainEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174050', description: 'Id used to remove the domain' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001' })
  schoolId: string;

  @ApiProperty({ example: 'lycee-leclerc.edu' })
  domain: string;

  @ApiProperty({ example: '2026-11-17T12:00:00.000Z' })
  createdAt: Date;

  constructor(partial: SchoolDomainEntity) {
    Object.assign(this, partial);
  }
}
